package validator

import (
	"regexp"

	"github.com/go-playground/validator/v10"
)

var (
	usernameRegex = regexp.MustCompile(`^[a-z0-9_]+$`)
)

type CustomValidator struct {
	validator *validator.Validate
}

func New() *CustomValidator {
	v := validator.New()
	_ = v.RegisterValidation("username", func(fl validator.FieldLevel) bool {
		return usernameRegex.MatchString(fl.Field().String())
	})
	return &CustomValidator{validator: v}
}

func (cv *CustomValidator) Validate(i interface{}) error {
	return cv.validator.Struct(i)
}
