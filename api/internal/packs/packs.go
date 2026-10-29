// Package packs checks a shared training pack strictly before it is kept (the page's format 1: client/src/training/
// pack.ts; notes/custom-training.md §1.2–1.4): pure data, never evaluated. One JSON value, no field it doesn't know; its
// name and description printable ASCII within their lengths and past the word filter (names.Allowed); 1 to 50 shots, each
// number finite and within the arena's box and the speeds the game uses, each rotator whole Unreal units within its
// range. A pack kept is its canonical form (Pack.File), never the bytes as sent. Share codes: XXXX-XXXX-XXXX-XXXX, 64
// bits from crypto/rand (the game's codes are 16 hex digits in four groups too: §1.3).
package packs

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"regexp"
	"slices"
	"strings"

	"carball/api/internal/names"
)

// The format's limits (the page's PACK_LIMITS, EDITOR_LIMITS): shots a pack, the name's and the description's lengths
// (characters: ASCII, so bytes too), the tags a pack may have, a pack's body at most (bytes)
const (
	Format         = 1
	MinShots       = 1
	MaxShots       = 50
	NameMin        = 3
	NameMax        = 30
	DescriptionMax = 200
	MaxTags        = 4
	MaxBytes       = 64 << 10
)

// The arena's box a start must be in (uu: the goals' depth past the back walls, the ceiling), the speeds (uu/s), the
// time limit (s), the launch's and the car's pitch (a quarter turn), a turn (Unreal units)
const (
	HalfX     = 4096
	HalfY     = 6000
	Top       = 2044
	BallSpeed = 6000
	CarSpeed  = 2300
	TimeLimit = 59
	Pitch     = 16384
	Turn      = 65536
)

// Tags are the game's training tags (ETrainingTag), by name
var Tags = []string{"Aerials", "Bounces", "Shots", "Saves", "Clears", "Rebounds", "Redirects", "Freestyles", "Dribbles",
	"AirDribbles", "Kickoffs", "WallShots", "LongShots", "CloseShots", "AngleShots", "BackwardsShots", "Offense", "Defense",
	"PinchShots"}

// allowed is the word filter on a name or description (names.Allowed; the tests' a stand-in, so they need no word it
// refuses)
var allowed = names.Allowed

var (
	types        = map[string]bool{"striker": true, "goalie": true, "aerial": true}
	difficulties = map[string]bool{"easy": true, "medium": true, "hard": true}
	localID      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	codeShape    = regexp.MustCompile(`^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$`)
)

// Error is why a pack was refused: Code the page's (pack-invalid, pack-name, pack-name-not-allowed, pack-description,
// pack-description-not-allowed), Detail what in it (the page shows it with pack-invalid: "shot 3: its ball")
type Error struct {
	Code, Detail string
}

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

func invalid(format string, args ...any) error {
	return &Error{Code: "pack-invalid", Detail: fmt.Sprintf(format, args...)}
}

// Rotator is an Unreal rotator, whole units (65536 a turn)
type Rotator struct {
	Pitch int `json:"pitch"`
	Yaw   int `json:"yaw"`
	Roll  int `json:"roll"`
}

// Ball is a shot's ball: its centre, the launch's direction (pitch and yaw; its roll unused) and speed
type Ball struct {
	Location [3]float64 `json:"location"`
	Launch   Rotator    `json:"launch"`
	Speed    float64    `json:"speed"`
}

// Car is a shot's car: its origin, rotation and start speed
type Car struct {
	Location   [3]float64 `json:"location"`
	Rotation   Rotator    `json:"rotation"`
	StartSpeed float64    `json:"startSpeed"`
}

// Shot is one of a pack's shots
type Shot struct {
	TimeLimit float64 `json:"timeLimit"`
	Ball      Ball    `json:"ball"`
	Car       Car     `json:"car"`
}

// Pack is a pack as checked
type Pack struct {
	Name, Description, Type, Difficulty string
	Tags                                []string
	Shots                               []Shot
}

// (the wire's shapes: every field a pointer, so a missing one is told from a zero)
type wireRotator struct {
	Pitch *float64 `json:"pitch"`
	Yaw   *float64 `json:"yaw"`
	Roll  *float64 `json:"roll"`
}

type wireBall struct {
	Location []float64    `json:"location"`
	Launch   *wireRotator `json:"launch"`
	Speed    *float64     `json:"speed"`
}

type wireCar struct {
	Location   []float64    `json:"location"`
	Rotation   *wireRotator `json:"rotation"`
	StartSpeed *float64     `json:"startSpeed"`
}

type wireShot struct {
	TimeLimit *float64  `json:"timeLimit"`
	Ball      *wireBall `json:"ball"`
	Car       *wireCar  `json:"car"`
}

type wirePack struct {
	Format      *int       `json:"format"`
	ID          *string    `json:"id"`
	Name        *string    `json:"name"`
	Type        *string    `json:"type"`
	Difficulty  *string    `json:"difficulty"`
	Tags        []string   `json:"tags"`
	Description *string    `json:"description"`
	Creator     *string    `json:"creator"`
	Shots       []wireShot `json:"shots"`
}

// Parse checks a pack as sent (the page's pack file): one JSON value, at most MaxBytes, no unknown field; its creator, if
// any, ignored (the uploader's display name is shown), its id the page's own (checked, not kept)
func Parse(raw []byte) (Pack, error) {
	if len(raw) > MaxBytes {
		return Pack{}, invalid("over %d bytes", MaxBytes)
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var w wirePack
	if err := d.Decode(&w); err != nil {
		return Pack{}, invalid("not a pack: %v", err)
	}
	if err := d.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Pack{}, invalid("one JSON value only")
	}
	if err := strictKeys(raw); err != nil {
		return Pack{}, err
	}
	if w.Format == nil || *w.Format != Format {
		return Pack{}, invalid("its format")
	}
	if w.ID == nil || !localID.MatchString(*w.ID) {
		return Pack{}, invalid("its id")
	}
	if w.Type == nil || !types[*w.Type] {
		return Pack{}, invalid("its type")
	}
	if w.Difficulty == nil || !difficulties[*w.Difficulty] {
		return Pack{}, invalid("its difficulty")
	}
	if w.Creator != nil && len(*w.Creator) > 64 {
		return Pack{}, invalid("its creator")
	}
	p := Pack{Type: *w.Type, Difficulty: *w.Difficulty, Tags: []string{}}
	if w.Name == nil {
		return Pack{}, &Error{Code: "pack-name", Detail: "none"}
	}
	name, err := Text(*w.Name, NameMin, NameMax, "pack-name")
	if err != nil {
		return Pack{}, err
	}
	p.Name = name
	if w.Description != nil {
		description, err := Text(*w.Description, 0, DescriptionMax, "pack-description")
		if err != nil {
			return Pack{}, err
		}
		p.Description = description
	}
	if len(w.Tags) > MaxTags {
		return Pack{}, invalid("over %d tags", MaxTags)
	}
	for _, t := range w.Tags {
		if !slices.Contains(Tags, t) || slices.Contains(p.Tags, t) {
			return Pack{}, invalid("its tags")
		}
		p.Tags = append(p.Tags, t)
	}
	if len(w.Shots) < MinShots || len(w.Shots) > MaxShots {
		return Pack{}, invalid("its shots (%d to %d)", MinShots, MaxShots)
	}
	for i, ws := range w.Shots {
		s, why := shot(ws)
		if why != "" {
			return Pack{}, invalid("shot %d: its %s", i+1, why)
		}
		p.Shots = append(p.Shots, s)
	}
	return p, nil
}

// keyNames are the wire's field names (its shapes' json tags), exactly as written
var keyNames = wireNames(reflect.TypeFor[wirePack](), map[string]bool{})

func wireNames(t reflect.Type, into map[string]bool) map[string]bool {
	if k := t.Kind(); k == reflect.Pointer || k == reflect.Slice || k == reflect.Array {
		return wireNames(t.Elem(), into)
	}
	// (a plain value: no names in it)
	if t.Kind() != reflect.Struct {
		return into
	}
	for i := range t.NumField() {
		name, _, _ := strings.Cut(t.Field(i).Tag.Get("json"), ",")
		into[name] = true
		wireNames(t.Field(i).Type, into)
	}
	return into
}

// strictKeys refuses what encoding/json lets by (RV-1201): a key twice in an object (it keeps the last) or a key not
// written exactly as the wire's (it matches without case); raw is one JSON value already decoded, so well formed
func strictKeys(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	// (the containers open: an object's keys so far, nil for an array; whether the next token is a key)
	var open []map[string]bool
	key := false
	for {
		t, err := d.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return invalid("not a pack: %v", err)
		}
		if key {
			if k, ok := t.(string); ok {
				seen := open[len(open)-1]
				switch {
				case !keyNames[k]:
					return invalid("a field it doesn't know: %.40q", k)
				case seen[k]:
					return invalid("a field twice: %q", k)
				}
				seen[k] = true
				key = false
				continue
			}
		}
		switch t {
		case json.Delim('{'):
			open = append(open, map[string]bool{})
			key = true
			continue
		case json.Delim('['):
			open = append(open, nil)
			key = false
			continue
		case json.Delim('}'), json.Delim(']'):
			open = open[:len(open)-1]
		}
		// (a value ended: in an object, a key or its end next)
		key = len(open) > 0 && open[len(open)-1] != nil
	}
}

// Text is a pack's name or description as kept: printable ASCII alone (spaces allowed, the ends' taken off), least to
// most characters, past the word filter; else an Error with `code` ("-not-allowed" after it for the filter's)
func Text(asked string, least, most int, code string) (string, error) {
	t := strings.Trim(asked, " ")
	for i := 0; i < len(t); i++ {
		if t[i] < 0x20 || t[i] > 0x7e {
			return "", &Error{Code: code, Detail: "a character other than printable ASCII"}
		}
	}
	if len(t) < least || len(t) > most {
		return "", &Error{Code: code, Detail: fmt.Sprintf("%d to %d characters", least, most)}
	}
	if t != "" && !allowed(t) {
		return "", &Error{Code: code + "-not-allowed", Detail: "the word filter"}
	}
	return t, nil
}

// within: a number present and in [lo, hi] (JSON has no NaN or infinity; a number past float64's range fails to decode)
func within(v *float64, lo, hi float64) bool {
	return v != nil && !math.IsNaN(*v) && *v >= lo && *v <= hi
}

// whole: a whole number of units in [lo, hi]
func whole(v *float64, lo, hi float64) (int, bool) {
	if !within(v, lo, hi) || math.Trunc(*v) != *v {
		return 0, false
	}
	return int(*v), true
}

func location(v []float64) ([3]float64, bool) {
	if len(v) != 3 {
		return [3]float64{}, false
	}
	x, y, z := v[0], v[1], v[2]
	if !within(&x, -HalfX, HalfX) || !within(&y, -HalfY, HalfY) || !within(&z, 0, Top) {
		return [3]float64{}, false
	}
	return [3]float64{x, y, z}, true
}

// rotator: pitch within a quarter turn, yaw in [0, a turn), roll within half a turn (absent: 0)
func rotator(r *wireRotator) (Rotator, bool) {
	if r == nil {
		return Rotator{}, false
	}
	pitch, okP := whole(r.Pitch, -Pitch, Pitch)
	yaw, okY := whole(r.Yaw, 0, Turn-1)
	roll := 0
	okR := true
	if r.Roll != nil {
		roll, okR = whole(r.Roll, -Turn/2, Turn/2)
	}
	return Rotator{Pitch: pitch, Yaw: yaw, Roll: roll}, okP && okY && okR
}

// shot: a shot checked, else what's wrong in it ("" none)
func shot(w wireShot) (Shot, string) {
	if !within(w.TimeLimit, 0, TimeLimit) {
		return Shot{}, "time limit"
	}
	if w.Ball == nil || w.Car == nil {
		return Shot{}, "ball or car"
	}
	ballAt, okAt := location(w.Ball.Location)
	launch, okLaunch := rotator(w.Ball.Launch)
	if !okAt || !okLaunch || !within(w.Ball.Speed, 0, BallSpeed) {
		return Shot{}, "ball"
	}
	carAt, okCar := location(w.Car.Location)
	rotation, okRot := rotator(w.Car.Rotation)
	startSpeed := 0.0
	if w.Car.StartSpeed != nil {
		if !within(w.Car.StartSpeed, 0, CarSpeed) {
			return Shot{}, "car"
		}
		startSpeed = *w.Car.StartSpeed
	}
	if !okCar || !okRot {
		return Shot{}, "car"
	}
	// (the launch's roll has no effect: kept as 0, as the page's)
	launch.Roll = 0
	return Shot{
		TimeLimit: *w.TimeLimit,
		Ball:      Ball{Location: ballAt, Launch: launch, Speed: *w.Ball.Speed},
		Car:       Car{Location: carAt, Rotation: rotation, StartSpeed: startSpeed},
	}, ""
}

// File is the pack as kept and handed out (format 1): `id` the shared pack's (SharedID), `creator` its uploader's display
// name ("" as kept: the read fills it in)
func (p Pack) File(id, creator string) ([]byte, error) {
	return json.Marshal(struct {
		Format      int      `json:"format"`
		ID          string   `json:"id"`
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Difficulty  string   `json:"difficulty"`
		Tags        []string `json:"tags"`
		Description string   `json:"description"`
		Creator     string   `json:"creator"`
		Shots       []Shot   `json:"shots"`
	}{Format, id, p.Name, p.Type, p.Difficulty, p.Tags, p.Description, creator, p.Shots})
}

// NewCode is a fresh share code: XXXX-XXXX-XXXX-XXXX, 16 upper-case hex digits from crypto/rand
func NewCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // (crypto/rand never fails on a supported system)
	h := strings.ToUpper(hex.EncodeToString(b))
	return h[0:4] + "-" + h[4:8] + "-" + h[8:12] + "-" + h[12:16]
}

// ValidCode: a share code's shape (as the page sends it: upper case, its dashes)
func ValidCode(code string) bool { return codeShape.MatchString(code) }

// SharedID is a shared pack's id in its file: shared-<its code, lower case> (the page's pack ids' alphabet)
func SharedID(code string) string { return "shared-" + strings.ToLower(code) }
