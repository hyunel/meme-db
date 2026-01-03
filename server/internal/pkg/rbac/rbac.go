// Package rbac provides role-based access control for the application.
package rbac

// Role levels for authorization checks.
const (
	LevelGuest = 0
	LevelUser  = 100
	LevelAdmin = 1000
)

// Well-known role codes
const (
	RoleGuest = "guest"
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// RoleLevel maps role codes to their privilege levels.
var RoleLevel = map[string]int{
	RoleGuest: LevelGuest,
	RoleUser:  LevelUser,
	RoleAdmin: LevelAdmin,
}
