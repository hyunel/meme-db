package model

import "time"

// Period is how far back popularity counts.
type Period string

const (
	PeriodDay   Period = "day"
	PeriodWeek  Period = "week"
	PeriodMonth Period = "month"
)

// Window is the period's span, zero if it names none.
func (p Period) Window() time.Duration {
	switch p {
	case PeriodDay:
		return 24 * time.Hour
	case PeriodWeek:
		return 7 * 24 * time.Hour
	case PeriodMonth:
		return 30 * 24 * time.Hour
	}
	return 0
}

// OrWeek is a week when the period is empty or unknown.
func (p Period) OrWeek() Period {
	if p.Window() == 0 {
		return PeriodWeek
	}
	return p
}
