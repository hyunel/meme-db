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

// LibraryService manages users' libraries (folders and files) and their public views.
type LibraryService struct {
	repo   *repository.Provider
	memes  *MemeService
	assets *AssetService
}

func NewLibraryService(repo *repository.Provider, memes *MemeService, assets *AssetService) *LibraryService {
	return &LibraryService{repo: repo, memes: memes, assets: assets}
}

// Folders returns folder views for ids, in the order of ids.
func (s *LibraryService) Folders(ctx context.Context, viewer *rbac.Identity, ids []string) ([]*model.Folder, error) {
	folders, err := s.repo.Node.Folders(ctx, viewer.UserID, ids)
	if err != nil {
		return nil, err
	}
	s.assets.signFolders(folders)
	return orderByID(folders, ids, func(f *model.Folder) string { return f.ID }), nil
}

// ==============================================================================
// Owner's library
// ==============================================================================

type LibraryView struct {
	Folder    *model.Folder   `json:"folder"`    // Nil at the root
	Ancestors []model.Crumb   `json:"ancestors"` // Root first, excluding Folder
	Folders   []*model.Folder `json:"folders"`
	Entries   []*model.Entry  `json:"entries"`
}

// Get lists a folder of the viewer's library (nil = the root).
func (s *LibraryService) Get(ctx context.Context, viewer *rbac.Identity, folderID *string) (*LibraryView, error) {
	view := &LibraryView{Ancestors: []model.Crumb{}, Entries: []*model.Entry{}}
	parentPublic := false
	if folderID != nil {
		folder, err := s.ownedFolder(ctx, viewer.UserID, *folderID)
		if err != nil {
			return nil, err
		}
		ancestors, err := s.repo.Node.Ancestors(ctx, folder.Path)
		if err != nil {
			return nil, err
		}
		parentPublic = folder.IsPublic
		for _, a := range ancestors {
			view.Ancestors = append(view.Ancestors, model.Crumb{ID: a.ID, Name: a.Name})
			parentPublic = parentPublic || a.IsPublic
		}
		folders, err := s.Folders(ctx, viewer, []string{folder.ID})
		if err != nil {
			return nil, err
		}
		view.Folder = folders[0]
	}

	children, err := s.repo.Node.Children(ctx, viewer.UserID, folderID)
	if err != nil {
		return nil, err
	}
	var folderIDs, assetIDs []string
	for _, n := range children {
		if n.Type == model.NodeTypeFolder {
			folderIDs = append(folderIDs, n.ID)
		} else {
			assetIDs = append(assetIDs, *n.AssetID)
		}
	}
	if view.Folders, err = s.Folders(ctx, viewer, folderIDs); err != nil {
		return nil, err
	}
	memes, err := s.memes.Memes(ctx, viewer, assetIDs)
	if err != nil {
		return nil, err
	}
	memeByID := make(map[string]*model.Meme, len(memes))
	for _, m := range memes {
		memeByID[m.ID] = m
	}
	for _, n := range children {
		if n.Type == model.NodeTypeFile {
			view.Entries = append(view.Entries, &model.Entry{
				ID:         n.ID,
				ParentID:   n.ParentID,
				Name:       n.Name,
				Visibility: visibility(n.IsPublic, parentPublic),
				Meme:       memeByID[*n.AssetID],
				CreatedAt:  n.CreatedAt,
			})
		}
	}
	return view, nil
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

// Upload stores a file and adds it to the viewer's library.
func (s *LibraryService) Upload(ctx context.Context, viewer *rbac.Identity, parentID *string, file *multipart.FileHeader) (*model.EntryRef, error) {
	asset, err := s.assets.CreateAsset(ctx, viewer.UserID, file)
	if err != nil {
		return nil, err
	}
	return s.addFile(ctx, viewer.UserID, parentID, asset.ID, filepath.Base(file.Filename))
}

// AddMeme adds a meme the viewer can see to their library.
func (s *LibraryService) AddMeme(ctx context.Context, viewer *rbac.Identity, memeID string, parentID *string) (*model.EntryRef, error) {
	meme, err := s.memes.Get(ctx, viewer, memeID)
	if err != nil {
		return nil, err
	}
	asset, err := s.repo.Asset.Get(ctx, memeID)
	if err != nil {
		return nil, err
	}
	name := "meme"
	if len(meme.Keywords) > 0 {
		name = meme.Keywords[0]
	}
	return s.addFile(ctx, viewer.UserID, parentID, memeID, name+asset.Extension)
}

func (s *LibraryService) addFile(ctx context.Context, ownerID string, parentID *string, assetID, name string) (*model.EntryRef, error) {
	taken, err := s.takenNames(ctx, ownerID, parentID)
	if err != nil {
		return nil, err
	}
	node, err := s.create(ctx, &model.Node{
		OwnerID:  ownerID,
		ParentID: parentID,
		Name:     uniqueName(taken, name),
		Type:     model.NodeTypeFile,
		AssetID:  &assetID,
	})
	if err != nil {
		return nil, err
	}
	return &model.EntryRef{ID: node.ID, FolderID: node.ParentID}, nil
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

// Move moves nodes into a folder (nil = the root); names taken there get a numeric suffix.
func (s *LibraryService) Move(ctx context.Context, viewer *rbac.Identity, ids []string, targetID *string) error {
	nodes, target, taken, err := s.prepareTransfer(ctx, viewer.UserID, ids, targetID)
	if err != nil {
		return err
	}
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		for _, n := range nodes {
			if equalIDs(n.ParentID, targetID) {
				continue
			}
			name := uniqueName(taken, n.Name)
			taken[name] = true
			if err := r.Node.Move(ctx, n.ID, targetID, childPath(target, n.ID), name); err != nil {
				return err
			}
		}
		return nil
	})
}

// Copy copies nodes and their subtrees into a folder (nil = the root) as private items.
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

// prepareTransfer loads the owner's nodes to move or copy, the target folder (nil = the
// root) and the names taken in it, rejecting a target inside one of the nodes.
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

// uniqueName returns name, or "base (n).ext" with the smallest n not yet taken.
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

// childPath is the ltree path of node id placed under parent (nil = the root).
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

func equalIDs(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// ==============================================================================
// Public views
// ==============================================================================

// PublicFolders lists the topmost public folders, most favorited first.
func (s *LibraryService) PublicFolders(ctx context.Context, viewer *rbac.Identity, limit int) ([]*model.Folder, error) {
	ids, err := s.repo.Node.PublicRootFolders(ctx, "", limit)
	if err != nil {
		return nil, err
	}
	return s.Folders(ctx, viewer, ids)
}

type FolderPage struct {
	Folder    *model.Folder   `json:"folder"`
	Ancestors []model.Crumb   `json:"ancestors"` // The viewer-visible part of the path, root first
	Folders   []*model.Folder `json:"folders"`
	Memes     []*model.Meme   `json:"memes"`
}

// PublicFolder shows a folder that is public (or the viewer's own) with its contents.
func (s *LibraryService) PublicFolder(ctx context.Context, viewer *rbac.Identity, id string) (*FolderPage, error) {
	notFound := apperror.NotFound("合集不存在或未公开")
	node, err := s.repo.Node.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil || node.Type != model.NodeTypeFolder {
		return nil, notFound
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
	page := &FolderPage{Ancestors: []model.Crumb{}}
	public := false
	for _, a := range ancestors {
		public = public || a.IsPublic
		if public || own {
			page.Ancestors = append(page.Ancestors, model.Crumb{ID: a.ID, Name: a.Name})
		}
	}
	if !own && (!(public || node.IsPublic) || owner.Status != model.UserStatusActive) {
		return nil, notFound
	}

	folders, err := s.Folders(ctx, viewer, []string{id})
	if err != nil {
		return nil, err
	}
	page.Folder = folders[0]

	children, err := s.repo.Node.Children(ctx, node.OwnerID, &id)
	if err != nil {
		return nil, err
	}
	var folderIDs, assetIDs []string
	for _, n := range children {
		if n.Type == model.NodeTypeFolder {
			folderIDs = append(folderIDs, n.ID)
		} else {
			assetIDs = append(assetIDs, *n.AssetID)
		}
	}
	if page.Folders, err = s.Folders(ctx, viewer, folderIDs); err != nil {
		return nil, err
	}
	if page.Memes, err = s.memes.Memes(ctx, viewer, assetIDs); err != nil {
		return nil, err
	}
	return page, nil
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
