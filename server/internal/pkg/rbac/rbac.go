// Package rbac provides role-based access control for the application.
package rbac

const (
	RoleGuest = "guest"
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// Scopes of API tokens; each grants what the ones before it do.
const (
	ScopeRead  = "read"  // Reads of signed-in users
	ScopeWrite = "write" // Anything signed-in users may do, except account security
	ScopeAdmin = "admin" // The admin API as well
)

type Identity struct {
	UserID string // Empty for guests
	Role   string
	Scope  string // Of the API token in use; empty for a signed-in session
}

// IsAdmin reports whether the identity may act as an admin, which an API token needs the admin scope for.
func (i *Identity) IsAdmin() bool {
	return i != nil && i.Role == RoleAdmin && (i.Scope == "" || i.Scope == ScopeAdmin)
}
