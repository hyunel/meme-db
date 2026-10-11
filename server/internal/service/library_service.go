package service

import (
	"context"
	"fmt"
	"mime/multipart"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyunel/MemeDB/internal/model"
	"github.com/hyunel/MemeDB/internal/pkg/apperror"
	"github.com/hyunel/MemeDB/internal/pkg/rbac"
	"github.com/hyunel/MemeDB/internal/repository"
)

type LibraryService struct {
	repo   *repository.Provider
	memes  *MemeService
	assets *AssetService
}

func NewLibraryService(repo *repository.Provider, memes *MemeService, assets *AssetService) *LibraryService {
	return &LibraryService{repo: repo, memes: memes, assets: assets}
}

func (s *LibraryService) Folders(ctx context.Context, viewer *rbac.Identity, ids []string) ([]*model.Folder, error) {
	folders, err := s.repo.Node.Folders(ctx, viewer.UserID, ids)
	if err != nil {
		return nil, err
	}
	s.assets.signFolders(folders)
	return orderByID(folders, ids, func(f *model.Folder) string { return f.ID }), nil
}

// FolderTree lists every folder of the viewer's library, for choosing where to put something.
func (s *LibraryService) FolderTree(ctx context.Context, viewer *rbac.Identity) ([]*model.FolderRef, error) {
	return s.repo.Node.FolderTree(ctx, viewer.UserID)
}

type LibraryView struct {
	Folder    *model.Folder   `json:"folder"`    // Nil at the root of the viewer's library
	Ancestors []model.Crumb   `json:"ancestors"` // The viewer-visible folders above Folder, root first
	Folders   []*model.Folder `json:"folders"`
	Entries   []*model.Entry  `json:"entries"`
}

// Get lists a folder of the viewer's library, or its root.
func (s *LibraryService) Get(ctx context.Context, viewer *rbac.Identity, folderID *string) (*LibraryView, error) {
	var folder *located
	if folderID != nil {
		var err error
		if folder, err = s.locate(ctx, viewer, *folderID, model.NodeTypeFolder); err != nil {
			return nil, err
		}
		if folder == nil || folder.OwnerID != viewer.UserID {
			return nil, apperror.NotFound("文件夹不存在")
		}
	}
	return s.view(ctx, viewer, folder)
}

// PublicFolder lists a folder opened by its link, which may be another user's public one.
func (s *LibraryService) PublicFolder(ctx context.Context, viewer *rbac.Identity, id string) (*LibraryView, error) {
	folder, err := s.locate(ctx, viewer, id, model.NodeTypeFolder)
	if err != nil {
		return nil, err
	}
	if folder == nil {
		return nil, apperror.NotFound("合集不存在或未公开")
	}
	return s.view(ctx, viewer, folder)
}

// view lists a folder, or the root of the viewer's library if it is nil.
func (s *LibraryService) view(ctx context.Context, viewer *rbac.Identity, folder *located) (*LibraryView, error) {
	view := &LibraryView{Ancestors: []model.Crumb{}}
	ownerID, parentID, public := viewer.UserID, (*string)(nil), false
	if folder != nil {
		folders, err := s.Folders(ctx, viewer, []string{folder.ID})
		if err != nil {
			return nil, err
		}
		view.Folder, view.Ancestors = folders[0], folder.Ancestors
		ownerID, parentID, public = folder.OwnerID, &folder.ID, folder.IsPublic || folder.InPublic
	}

	children, err := s.repo.Node.Children(ctx, ownerID, parentID)
	if err != nil {
		return nil, err
	}
	folderIDs, files := splitChildren(children)
	if view.Folders, err = s.Folders(ctx, viewer, folderIDs); err != nil {
		return nil, err
	}
	view.Entries, err = s.entries(ctx, viewer, files, public)
	return view, err
}

type EntryDetail struct {
	*model.Entry
	Owner     model.UserRef `json:"owner"`
	Ancestors []model.Crumb `json:"ancestors"` // The viewer-visible folders above it, root first
}

// Entry finds a file opened by its link, which may be in another user's public folder.
func (s *LibraryService) Entry(ctx context.Context, viewer *rbac.Identity, id string) (*EntryDetail, error) {
	file, err := s.locate(ctx, viewer, id, model.NodeTypeFile)
	if err != nil {
		return nil, err
	}
	var entries []*model.Entry
	if file != nil {
		if entries, err = s.entries(ctx, viewer, []*model.Node{file.Node}, file.InPublic); err != nil {
			return nil, err
		}
	}
	if len(entries) == 0 {
		return nil, apperror.NotFound("表情包不存在或未公开")
	}
	return &EntryDetail{Entry: entries[0], Owner: model.UserRef{ID: file.Owner.ID, Username: file.Owner.Username}, Ancestors: file.Ancestors}, nil
}

// entries lists the files whose memes the viewer may see; inPublic tells whether a folder above them is public.
func (s *LibraryService) entries(ctx context.Context, viewer *rbac.Identity, files []*model.Node, inPublic bool) ([]*model.Entry, error) {
	assetIDs := make([]string, len(files))
	for i, n := range files {
		assetIDs[i] = *n.AssetID
	}
	memes, err := s.memes.Memes(ctx, viewer, assetIDs)
	if err != nil {
		return nil, err
	}
	memeByID := make(map[string]*model.Meme, len(memes))
	for _, m := range memes {
		memeByID[m.ID] = m
	}

	entries := []*model.Entry{}
	for _, n := range files {
		if meme, ok := memeByID[*n.AssetID]; ok {
			entries = append(entries, &model.Entry{
				ID:         n.ID,
				ParentID:   n.ParentID,
				Name:       n.Name,
				Visibility: visibility(n.IsPublic, inPublic),
				Meme:       meme,
				CreatedAt:  n.CreatedAt,
			})
		}
	}
	return entries, nil
}

type located struct {
	*model.Node
	Owner     *model.User
	Ancestors []model.Crumb // The viewer-visible folders above it, root first
	InPublic  bool          // Whether a folder above it is public
}

// locate finds a node the viewer may see: any of their own, or a public one of an active user,
// whose path others see from the topmost public folder down.
func (s *LibraryService) locate(ctx context.Context, viewer *rbac.Identity, id string, nodeType model.NodeType) (*located, error) {
	node, err := s.repo.Node.Get(ctx, id)
	if err != nil || node == nil || node.Type != nodeType {
		return nil, err
	}
	owner, err := s.repo.User.Get(ctx, node.OwnerID)
	if err != nil {
		return nil, err
	}
	ancestors, err := s.repo.Node.Ancestors(ctx, node.Path)
	if err != nil {
		return nil, err
	}

	own := node.OwnerID == viewer.UserID
	loc := &located{Node: node, Owner: owner, Ancestors: []model.Crumb{}}
	for _, a := range ancestors {
		loc.InPublic = loc.InPublic || a.IsPublic
		if loc.InPublic || own {
			loc.Ancestors = append(loc.Ancestors, model.Crumb{ID: a.ID, Name: a.Name})
		}
	}
	if !own && (!(loc.InPublic || node.IsPublic) || owner.Status != model.UserStatusActive) {
		return nil, nil
	}
	return loc, nil
}

func (s *LibraryService) CreateFolder(ctx context.Context, viewer *rbac.Identity, parentID *string, name string) (*model.Folder, error) {
	taken, err := s.takenNames(ctx, viewer.UserID, parentID)
	if err != nil {
		return nil, err
	}
	if taken[name] {
		return nil, apperror.Conflict("同一位置已存在同名项目")
	}
	node, err := s.create(ctx, &model.Node{OwnerID: viewer.UserID, ParentID: parentID, Name: name, Type: model.NodeTypeFolder})
	if err != nil {
		return nil, err
	}
	folders, err := s.Folders(ctx, viewer, []string{node.ID})
	if err != nil {
		return nil, err
	}
	return folders[0], nil
}

func (s *LibraryService) Upload(ctx context.Context, viewer *rbac.Identity, parentID *string, file *multipart.FileHeader) (*EntryDetail, bool, error) {
	asset, err := s.assets.CreateAsset(ctx, viewer.UserID, file)
	if err != nil {
		return nil, false, err
	}
	return s.addFile(ctx, viewer, parentID, asset.ID, filepath.Base(file.Filename))
}

func (s *LibraryService) AddMeme(ctx context.Context, viewer *rbac.Identity, memeID string, parentID *string) (*EntryDetail, bool, error) {
	meme, err := s.memes.Get(ctx, viewer, memeID)
	if err != nil {
		return nil, false, err
	}
	asset, err := s.repo.Asset.Get(ctx, memeID)
	if err != nil {
		return nil, false, err
	}
	name := "meme"
	if meme.Title != "" {
		name = meme.Title
	}
	return s.addFile(ctx, viewer, parentID, memeID, name+asset.Extension)
}

// addFile reports whether it created the entry; a file already in the folder is returned instead, so adding can be retried.
func (s *LibraryService) addFile(ctx context.Context, viewer *rbac.Identity, parentID *string, assetID, name string) (*EntryDetail, bool, error) {
	children, err := s.repo.Node.Children(ctx, viewer.UserID, parentID)
	if err != nil {
		return nil, false, err
	}
	taken := make(map[string]bool, len(children))
	for _, n := range children {
		if n.AssetID != nil && *n.AssetID == assetID {
			entry, err := s.Entry(ctx, viewer, n.ID)
			return entry, false, err
		}
		taken[n.Name] = true
	}

	node, err := s.create(ctx, &model.Node{
		OwnerID:  viewer.UserID,
		ParentID: parentID,
		Name:     uniqueName(taken, name),
		Type:     model.NodeTypeFile,
		AssetID:  &assetID,
	})
	if err != nil {
		return nil, false, err
	}
	entry, err := s.Entry(ctx, viewer, node.ID)
	return entry, true, err
}

func (s *LibraryService) Rename(ctx context.Context, viewer *rbac.Identity, id, name string) error {
	nodes, err := s.ownedNodes(ctx, viewer.UserID, []string{id})
	if err != nil {
		return err
	}
	if nodes[0].Name == name {
		return nil
	}
	taken, err := s.takenNames(ctx, viewer.UserID, nodes[0].ParentID)
	if err != nil {
		return err
	}
	if taken[name] {
		return apperror.Conflict("同一位置已存在同名项目")
	}
	return s.repo.Node.Rename(ctx, id, name)
}

func (s *LibraryService) SetPublic(ctx context.Context, viewer *rbac.Identity, ids []string, isPublic bool) error {
	return s.repo.Node.SetPublic(ctx, viewer.UserID, ids, isPublic)
}

func (s *LibraryService) Delete(ctx context.Context, viewer *rbac.Identity, ids []string) error {
	return s.repo.Node.Delete(ctx, viewer.UserID, ids)
}

func (s *LibraryService) Move(ctx context.Context, viewer *rbac.Identity, ids []string, targetID *string) error {
	nodes, target, taken, err := s.prepareTransfer(ctx, viewer.UserID, ids, targetID)
	if err != nil {
		return err
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		for _, n := range nodes {
			path := childPath(target, n.ID)
			if path == n.Path {
				continue // Already there
			}
			name := uniqueName(taken, n.Name)
			taken[name] = true
			if err := r.Node.Move(ctx, n.ID, targetID, path, name); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *LibraryService) Copy(ctx context.Context, viewer *rbac.Identity, ids []string, targetID *string) error {
	nodes, _, taken, err := s.prepareTransfer(ctx, viewer.UserID, ids, targetID)
	if err != nil {
		return err
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		for _, n := range nodes {
			name := uniqueName(taken, n.Name)
			taken[name] = true
			if err := copyTree(ctx, r, n, targetID, name); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *LibraryService) prepareTransfer(ctx context.Context, ownerID string, ids []string, targetID *string) ([]*model.Node, *model.Node, map[string]bool, error) {
	nodes, err := s.ownedNodes(ctx, ownerID, ids)
	if err != nil {
		return nil, nil, nil, err
	}
	var target *model.Node
	if targetID != nil {
		if target, err = s.ownedFolder(ctx, ownerID, *targetID); err != nil {
			return nil, nil, nil, err
		}
		for _, n := range nodes {
			if target.Path == n.Path || strings.HasPrefix(target.Path, n.Path+".") {
				return nil, nil, nil, apperror.BadRequest("不能把文件夹移动或复制到它自身或子文件夹中")
			}
		}
	}
	taken, err := s.takenNames(ctx, ownerID, targetID)
	return nodes, target, taken, err
}

func copyTree(ctx context.Context, r *repository.Repos, src *model.Node, parentID *string, name string) error {
	node, err := r.Node.Create(ctx, &model.Node{
		OwnerID:  src.OwnerID,
		ParentID: parentID,
		Name:     name,
		Type:     src.Type,
		AssetID:  src.AssetID,
	})
	if err != nil || src.Type != model.NodeTypeFolder {
		return err
	}
	children, err := r.Node.Children(ctx, src.OwnerID, &src.ID)
	if err != nil {
		return err
	}
	for _, child := range children {
		if err := copyTree(ctx, r, child, &node.ID, child.Name); err != nil {
			return err
		}
	}
	return nil
}

func (s *LibraryService) create(ctx context.Context, node *model.Node) (*model.Node, error) {
	created, err := s.repo.Node.Create(ctx, node)
	if err == nil && created == nil {
		err = apperror.NotFound("目标文件夹不存在")
	}
	return created, err
}

func (s *LibraryService) ownedNodes(ctx context.Context, ownerID string, ids []string) ([]*model.Node, error) {
	nodes, err := s.repo.Node.GetOwned(ctx, ownerID, ids)
	if err != nil {
		return nil, err
	}
	if len(nodes) != len(slices.Compact(slices.Sorted(slices.Values(ids)))) {
		return nil, apperror.NotFound("部分项目不存在或已被删除")
	}
	return nodes, nil
}

func (s *LibraryService) ownedFolder(ctx context.Context, ownerID, id string) (*model.Node, error) {
	node, err := s.repo.Node.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil || node.OwnerID != ownerID || node.Type != model.NodeTypeFolder {
		return nil, apperror.NotFound("文件夹不存在")
	}
	return node, nil
}

func (s *LibraryService) takenNames(ctx context.Context, ownerID string, parentID *string) (map[string]bool, error) {
	names, err := s.repo.Node.ChildNames(ctx, ownerID, parentID)
	taken := make(map[string]bool, len(names))
	for _, n := range names {
		taken[n] = true
	}
	return taken, err
}

func splitChildren(nodes []*model.Node) (folderIDs []string, files []*model.Node) {
	for _, n := range nodes {
		if n.Type == model.NodeTypeFolder {
			folderIDs = append(folderIDs, n.ID)
		} else {
			files = append(files, n)
		}
	}
	return folderIDs, files
}

func uniqueName(taken map[string]bool, name string) string {
	if !taken[name] {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		if candidate := fmt.Sprintf("%s (%d)%s", base, i, ext); !taken[candidate] {
			return candidate
		}
	}
}

func childPath(parent *model.Node, id string) string {
	label := strings.ReplaceAll(id, "-", "")
	if parent == nil {
		return label
	}
	return parent.Path + "." + label
}

func visibility(isPublic, parentPublic bool) string {
	switch {
	case isPublic:
		return model.VisibilityPublic
	case parentPublic:
		return model.VisibilityInherited
	default:
		return model.VisibilityPrivate
	}
}

func (s *LibraryService) PublicFolders(ctx context.Context, viewer *rbac.Identity, limit int) ([]*model.Folder, error) {
	ids, err := s.repo.Node.PublicRootFolders(ctx, "", limit)
	if err != nil {
		return nil, err
	}
	return s.Folders(ctx, viewer, ids)
}

func (s *LibraryService) MemeFolders(ctx context.Context, viewer *rbac.Identity, memeID string, limit int) ([]*model.Folder, error) {
	ids, err := s.repo.Node.MemeFolders(ctx, viewer.UserID, memeID, limit)
	if err != nil {
		return nil, err
	}
	return s.Folders(ctx, viewer, ids)
}

type Profile struct {
	User    model.PublicUser `json:"user"`
	Folders []*model.Folder  `json:"folders"` // Topmost public folders
	Memes   []*model.Meme    `json:"memes"`   // Public files at the root of the library
}

func (s *LibraryService) Profile(ctx context.Context, viewer *rbac.Identity, username string) (*Profile, error) {
	user, err := s.repo.User.GetByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status != model.UserStatusActive {
		return nil, apperror.NotFound("用户不存在")
	}

	folderIDs, err := s.repo.Node.PublicRootFolders(ctx, user.ID, 100)
	if err != nil {
		return nil, err
	}
	roots, err := s.repo.Node.Children(ctx, user.ID, nil)
	if err != nil {
		return nil, err
	}
	var assetIDs []string
	for _, n := range roots {
		if n.Type == model.NodeTypeFile && n.IsPublic {
			assetIDs = append(assetIDs, *n.AssetID)
		}
	}

	profile := &Profile{User: model.PublicUser{UserRef: model.UserRef{ID: user.ID, Username: user.Username}, CreatedAt: user.CreatedAt}}
	if profile.Folders, err = s.Folders(ctx, viewer, folderIDs); err != nil {
		return nil, err
	}
	if profile.Memes, err = s.memes.Memes(ctx, viewer, assetIDs); err != nil {
		return nil, err
	}
	return profile, nil
}
