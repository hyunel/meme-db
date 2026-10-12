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
	tags   *TagService
}

func NewLibraryService(repo *repository.Provider, memes *MemeService, assets *AssetService, tags *TagService) *LibraryService {
	return &LibraryService{repo: repo, memes: memes, assets: assets, tags: tags}
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
		if folder, err = s.locate(ctx, viewer, *folderID, model.NodeTypeFolder, ""); err != nil {
			return nil, err
		}
		if folder == nil || folder.OwnerID != viewer.UserID {
			return nil, apperror.NotFound("文件夹不存在")
		}
	}
	return s.view(ctx, viewer, folder)
}

type PublicFolderView struct {
	Folder    *model.Folder   `json:"folder"`
	Ancestors []model.Crumb   `json:"ancestors"` // The viewer-visible folders above Folder, root first
	Folders   []*model.Folder `json:"folders"`   // Its files are paged by FolderEntries
}

// PublicFolder shows a folder opened by its link, which may be another user's public one, or one a private link (share) opens.
func (s *LibraryService) PublicFolder(ctx context.Context, viewer *rbac.Identity, id, share string) (*PublicFolderView, error) {
	folder, err := s.publicFolder(ctx, viewer, id, share)
	if err != nil {
		return nil, err
	}
	folders, err := s.Folders(ctx, viewer, []string{folder.ID})
	if err != nil {
		return nil, err
	}
	children, err := s.repo.Node.Children(ctx, folder.OwnerID, &folder.ID)
	if err != nil {
		return nil, err
	}
	folderIDs, _ := splitChildren(children)
	view := &PublicFolderView{Folder: folders[0], Ancestors: folder.Ancestors}
	view.Folders, err = s.Folders(ctx, viewer, folderIDs)
	return view, err
}

// FolderEntries pages through the files of a folder opened by its link; the cursor is the id of the last file before.
func (s *LibraryService) FolderEntries(ctx context.Context, viewer *rbac.Identity, id, share, cursor string, limit int) (*model.Feed[*model.Entry], error) {
	folder, err := s.publicFolder(ctx, viewer, id, share)
	if err != nil {
		return nil, err
	}
	q := repository.FileQuery{ViewerID: viewer.UserID, Admin: viewer.IsAdmin() || folder.ViaLink, OwnerID: folder.OwnerID, ParentID: &folder.ID}
	files, err := s.repo.Node.Files(ctx, q, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	files, next := nextPage(files, limit, func(n *model.Node) string { return n.ID })
	entries, err := s.entries(ctx, viewer, files, folder.IsPublic || folder.InPublic, folder.ViaLink)
	if err != nil {
		return nil, err
	}
	return &model.Feed[*model.Entry]{Items: entries, Next: next}, nil
}

func (s *LibraryService) publicFolder(ctx context.Context, viewer *rbac.Identity, id, share string) (*located, error) {
	folder, err := s.locate(ctx, viewer, id, model.NodeTypeFolder, share)
	if err != nil {
		return nil, err
	}
	if folder == nil {
		return nil, apperror.NotFound("合集不存在或未公开")
	}
	return folder, nil
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
	view.Entries, err = s.entries(ctx, viewer, files, public, false)
	return view, err
}

type EntryDetail struct {
	*model.Entry
	Owner     model.UserRef `json:"owner"`
	Ancestors []model.Crumb `json:"ancestors"` // The viewer-visible folders above it, root first
}

// Entry finds a file opened by its link, which may be in another user's public folder, or in one a private link (share) opens.
func (s *LibraryService) Entry(ctx context.Context, viewer *rbac.Identity, id, share string) (*EntryDetail, error) {
	file, err := s.locate(ctx, viewer, id, model.NodeTypeFile, share)
	if err != nil {
		return nil, err
	}
	var entries []*model.Entry
	if file != nil {
		if entries, err = s.entries(ctx, viewer, []*model.Node{file.Node}, file.InPublic, file.ViaLink); err != nil {
			return nil, err
		}
	}
	if len(entries) == 0 {
		return nil, apperror.NotFound("表情包不存在或未公开")
	}
	return &EntryDetail{Entry: entries[0], Owner: model.UserRef{ID: file.Owner.ID, Username: file.Owner.Username}, Ancestors: file.Ancestors}, nil
}

// entries lists the files whose memes the viewer may see, or all of them with viaLink, as a private link opens them;
// inPublic tells whether a folder above them is public.
func (s *LibraryService) entries(ctx context.Context, viewer *rbac.Identity, files []*model.Node, inPublic, viaLink bool) ([]*model.Entry, error) {
	assetIDs := make([]string, len(files))
	for i, n := range files {
		assetIDs[i] = *n.AssetID
	}
	memes, err := s.memes.load(ctx, viewer, assetIDs, viewer.IsAdmin() || viaLink)
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
	ViaLink   bool          // Whether a private link to it or a folder above it opens it for the viewer
}

// locate finds a node the viewer may see: any of their own, or one of an active user that is public
// or that a private link (share) to a folder opens, whose path others see from the topmost public or linked folder down.
func (s *LibraryService) locate(ctx context.Context, viewer *rbac.Identity, id string, nodeType model.NodeType, share string) (*located, error) {
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
	linked := "" // The folder the link opens, at or above the node
	if share != "" && !own {
		if linked, err = s.repo.Share.Folder(ctx, share, node.Path); err != nil {
			return nil, err
		}
	}

	loc := &located{Node: node, Owner: owner, Ancestors: []model.Crumb{}}
	for _, a := range ancestors {
		loc.InPublic = loc.InPublic || a.IsPublic
		loc.ViaLink = loc.ViaLink || a.ID == linked
		if loc.InPublic || loc.ViaLink || own {
			loc.Ancestors = append(loc.Ancestors, model.Crumb{ID: a.ID, Name: a.Name})
		}
	}
	loc.ViaLink = loc.ViaLink || node.ID == linked
	if !own && (!(loc.InPublic || node.IsPublic || loc.ViaLink) || owner.Status != model.UserStatusActive) {
		return nil, nil
	}
	return loc, nil
}

func (s *LibraryService) CreateFolder(ctx context.Context, viewer *rbac.Identity, parentID *string, name string) (*model.Folder, error) {
	var node *model.Node
	err := s.inFolder(ctx, viewer.UserID, parentID, func(r *repository.Repos) (err error) {
		node, err = create(ctx, r, &model.Node{OwnerID: viewer.UserID, ParentID: parentID, Name: name, Type: model.NodeTypeFolder})
		return err
	})
	if err != nil {
		return nil, err
	}
	folders, err := s.Folders(ctx, viewer, []string{node.ID})
	if err != nil {
		return nil, err
	}
	return folders[0], nil
}

// Upload adds a file to the folder at path under the parent, making the folders missing on the way, and gives its meme the uploader's tags.
// A folder of the same name is used as it is, so uploading a folder again merges into it.
func (s *LibraryService) Upload(ctx context.Context, viewer *rbac.Identity, parentID *string, path, tags []string, file *multipart.FileHeader) (*EntryDetail, bool, error) {
	labels, err := s.tags.Resolve(ctx, tags, true)
	if err != nil {
		return nil, false, err
	}
	for _, name := range path {
		err := s.inFolder(ctx, viewer.UserID, parentID, func(r *repository.Repos) error {
			folder, err := r.Node.EnsureFolder(ctx, viewer.UserID, parentID, name)
			switch {
			case err != nil:
				return err
			case folder == nil:
				return apperror.NotFound("目标文件夹不存在")
			case folder.Type != model.NodeTypeFolder:
				return apperror.Conflict("同一位置已存在同名文件").OnField("path")
			}
			parentID = &folder.ID
			return nil
		})
		if err != nil {
			return nil, false, err
		}
	}
	asset, err := s.assets.CreateAsset(ctx, viewer.UserID, file)
	if err != nil {
		return nil, false, err
	}
	for _, label := range labels {
		if _, err := s.repo.Tag.AddUserLabel(ctx, asset.ID, label, viewer.UserID); err != nil {
			return nil, false, err
		}
	}
	return s.addFile(ctx, viewer, parentID, asset.ID, filepath.Base(file.Filename))
}

// AddMeme puts a meme the viewer may see, or one a private link (share) opens, into their library.
func (s *LibraryService) AddMeme(ctx context.Context, viewer *rbac.Identity, memeID string, parentID *string, share string) (*EntryDetail, bool, error) {
	meme, err := s.memes.Get(ctx, viewer, memeID, share)
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
	entry, created, err := s.addFile(ctx, viewer, parentID, memeID, name+asset.Extension)
	if err == nil && created && share != "" && len(meme.Entries) == 0 {
		err = s.repo.Share.Record(ctx, share, memeID, viewer.UserID, true) // The link brought the meme into a new library
	}
	return entry, created, err
}

// addFile reports whether it created the entry; a file already in the folder is returned instead, so adding can be retried.
func (s *LibraryService) addFile(ctx context.Context, viewer *rbac.Identity, parentID *string, assetID, name string) (*EntryDetail, bool, error) {
	var id string
	var created bool
	err := s.inFolder(ctx, viewer.UserID, parentID, func(r *repository.Repos) error {
		children, err := r.Node.Children(ctx, viewer.UserID, parentID)
		if err != nil {
			return err
		}
		taken := make(map[string]bool, len(children))
		for _, n := range children {
			if n.AssetID != nil && *n.AssetID == assetID {
				id = n.ID
				return nil
			}
			taken[n.Name] = true
		}
		node, err := create(ctx, r, &model.Node{OwnerID: viewer.UserID, ParentID: parentID, Name: uniqueName(taken, name), Type: model.NodeTypeFile, AssetID: &assetID})
		if err != nil {
			return err
		}
		id, created = node.ID, true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	entry, err := s.Entry(ctx, viewer, id, "")
	return entry, created, err
}

func (s *LibraryService) Rename(ctx context.Context, viewer *rbac.Identity, id, name string) error {
	nodes, err := s.ownedNodes(ctx, viewer.UserID, []string{id})
	if err != nil {
		return err
	}
	return s.inFolder(ctx, viewer.UserID, nodes[0].ParentID, func(r *repository.Repos) error {
		return nameConflict(r.Node.Rename(ctx, id, name))
	})
}

func (s *LibraryService) SetPublic(ctx context.Context, viewer *rbac.Identity, ids []string, isPublic bool) error {
	return s.repo.Node.SetPublic(ctx, viewer.UserID, ids, isPublic)
}

func (s *LibraryService) Delete(ctx context.Context, viewer *rbac.Identity, ids []string) error {
	return s.repo.Node.Delete(ctx, viewer.UserID, ids)
}

func (s *LibraryService) Move(ctx context.Context, viewer *rbac.Identity, ids []string, targetID *string) error {
	nodes, target, err := s.prepareTransfer(ctx, viewer.UserID, ids, targetID)
	if err != nil {
		return err
	}
	return s.inFolder(ctx, viewer.UserID, targetID, func(r *repository.Repos) error {
		taken, err := takenNames(ctx, r, viewer.UserID, targetID)
		if err != nil {
			return err
		}
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
	nodes, _, err := s.prepareTransfer(ctx, viewer.UserID, ids, targetID)
	if err != nil {
		return err
	}
	return s.inFolder(ctx, viewer.UserID, targetID, func(r *repository.Repos) error {
		taken, err := takenNames(ctx, r, viewer.UserID, targetID)
		if err != nil {
			return err
		}
		for _, n := range nodes {
			name := uniqueName(taken, n.Name)
			taken[name] = true
			if _, err := copyTree(ctx, r, viewer.UserID, n, targetID, name); err != nil {
				return err
			}
		}
		return nil
	})
}

// SaveFolder copies a folder the viewer may open, or one a private link (share) opens, with all it holds into their library.
func (s *LibraryService) SaveFolder(ctx context.Context, viewer *rbac.Identity, id string, parentID *string, share string) (*model.Folder, error) {
	folder, err := s.publicFolder(ctx, viewer, id, share)
	if err != nil {
		return nil, err
	}
	if folder.OwnerID == viewer.UserID {
		return nil, apperror.BadRequest("文件夹已在我的库中") // Its owner copies it with Copy, which keeps it out of itself
	}
	var copyID string
	err = s.inFolder(ctx, viewer.UserID, parentID, func(r *repository.Repos) error {
		taken, err := takenNames(ctx, r, viewer.UserID, parentID)
		if err != nil {
			return err
		}
		copyID, err = copyTree(ctx, r, viewer.UserID, folder.Node, parentID, uniqueName(taken, folder.Name))
		return err
	})
	if err != nil {
		return nil, err
	}
	if share != "" {
		if err := s.repo.Share.Record(ctx, share, id, viewer.UserID, true); err != nil {
			return nil, err
		}
	}
	folders, err := s.Folders(ctx, viewer, []string{copyID})
	if err != nil {
		return nil, err
	}
	return folders[0], nil
}

func (s *LibraryService) prepareTransfer(ctx context.Context, ownerID string, ids []string, targetID *string) ([]*model.Node, *model.Node, error) {
	nodes, err := s.ownedNodes(ctx, ownerID, ids)
	if err != nil {
		return nil, nil, err
	}
	var target *model.Node
	if targetID != nil {
		if target, err = s.ownedFolder(ctx, ownerID, *targetID); err != nil {
			return nil, nil, err
		}
		for _, n := range nodes {
			if target.Path == n.Path || strings.HasPrefix(target.Path, n.Path+".") {
				return nil, nil, apperror.BadRequest("不能把文件夹移动或复制到它自身或子文件夹中")
			}
		}
	}
	return nodes, target, nil
}

// copyTree copies a node, with all it holds if it is a folder, into the owner's folder (or root) as name, returning the id of the copy.
func copyTree(ctx context.Context, r *repository.Repos, ownerID string, src *model.Node, parentID *string, name string) (string, error) {
	node, err := create(ctx, r, &model.Node{OwnerID: ownerID, ParentID: parentID, Name: name, Type: src.Type, AssetID: src.AssetID})
	if err != nil {
		return "", err
	}
	if src.Type != model.NodeTypeFolder {
		return node.ID, nil
	}
	children, err := r.Node.Children(ctx, src.OwnerID, &src.ID)
	if err != nil {
		return "", err
	}
	for _, child := range children {
		if _, err := copyTree(ctx, r, ownerID, child, &node.ID, child.Name); err != nil {
			return "", err
		}
	}
	return node.ID, nil
}

// inFolder runs fn in a transaction holding the lock on the owner's folder (nil: their library root), which every change
// of the names in it takes first, so a name fn finds free there stays free until it commits.
func (s *LibraryService) inFolder(ctx context.Context, ownerID string, folderID *string, fn func(r *repository.Repos) error) error {
	return s.repo.Tx(ctx, func(r *repository.Repos) error {
		if err := r.Node.Lock(ctx, ownerID, folderID); err != nil {
			return err
		}
		return fn(r)
	})
}

// create adds a node to its parent, which must be one of the owner's folders.
func create(ctx context.Context, r *repository.Repos, node *model.Node) (*model.Node, error) {
	created, err := r.Node.Create(ctx, node)
	if err == nil && created == nil {
		err = apperror.NotFound("目标文件夹不存在")
	}
	return created, nameConflict(err)
}

// nameConflict reports a name its siblings already have, which the database refuses, as a conflict.
func nameConflict(err error) error {
	if repository.IsUniqueViolation(err) {
		return apperror.Conflict("同一位置已存在同名项目")
	}
	return err
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

func takenNames(ctx context.Context, r *repository.Repos, ownerID string, parentID *string) (map[string]bool, error) {
	children, err := r.Node.Children(ctx, ownerID, parentID)
	taken := make(map[string]bool, len(children))
	for _, n := range children {
		taken[n.Name] = true
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
	User      model.PublicUser `json:"user"`
	Folders   []*model.Folder  `json:"folders"`    // Topmost public folders
	MemeCount int              `json:"meme_count"` // Public files at the root of the library, paged by ProfileMemes
}

func (s *LibraryService) Profile(ctx context.Context, viewer *rbac.Identity, username string) (*Profile, error) {
	user, err := s.activeUser(ctx, username)
	if err != nil {
		return nil, err
	}
	folderIDs, err := s.repo.Node.PublicRootFolders(ctx, user.ID, 100)
	if err != nil {
		return nil, err
	}

	profile := &Profile{User: model.PublicUser{UserRef: model.UserRef{ID: user.ID, Username: user.Username}, CreatedAt: user.CreatedAt}}
	if profile.Folders, err = s.Folders(ctx, viewer, folderIDs); err != nil {
		return nil, err
	}
	profile.MemeCount, err = s.repo.Node.CountFiles(ctx, rootPublicFiles(viewer, user.ID))
	return profile, err
}

// ProfileMemes pages through the public files at the root of a user's library; the cursor is the id of the last file before.
func (s *LibraryService) ProfileMemes(ctx context.Context, viewer *rbac.Identity, username, cursor string, limit int) (*model.Feed[*model.Meme], error) {
	user, err := s.activeUser(ctx, username)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.Node.Files(ctx, rootPublicFiles(viewer, user.ID), cursor, limit+1)
	if err != nil {
		return nil, err
	}
	files, next := nextPage(files, limit, func(n *model.Node) string { return n.ID })
	ids := make([]string, len(files))
	for i, n := range files {
		ids[i] = *n.AssetID
	}
	memes, err := s.memes.Memes(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	return &model.Feed[*model.Meme]{Items: memes, Next: next}, nil
}

func rootPublicFiles(viewer *rbac.Identity, ownerID string) repository.FileQuery {
	return repository.FileQuery{ViewerID: viewer.UserID, Admin: viewer.IsAdmin(), OwnerID: ownerID, PublicOnly: true}
}

func (s *LibraryService) activeUser(ctx context.Context, username string) (*model.User, error) {
	user, err := s.repo.User.GetByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status != model.UserStatusActive {
		return nil, apperror.NotFound("用户不存在")
	}
	return user, nil
}
