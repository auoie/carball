package packs

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// A made-up pack's file, as the page writes it (myPacks.ts packFile), `shots` copies of one shot
func file(shots int) map[string]any {
	s := map[string]any{
		"timeLimit": 10.0,
		"ball":      map[string]any{"location": []any{120.5, 3010.25, 140.75}, "launch": map[string]any{"pitch": 4100.0, "yaw": 50123.0}, "speed": 1450.0},
		"car":       map[string]any{"location": []any{-210.5, -300.25, 17.25}, "rotation": map[string]any{"pitch": 10.0, "yaw": 15000.0, "roll": 20.0}, "startSpeed": 0.0},
	}
	list := make([]any, shots)
	for i := range list {
		list[i] = s
	}
	return map[string]any{"format": 1.0, "id": "mine-0abc1234", "name": "Made Up Drills", "type": "striker", "difficulty": "easy",
		"tags": []any{"Aerials"}, "description": "", "creator": "", "shots": list}
}

func raw(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// Shots: 1 and 50 kept, 0 and 51 refused
func TestShotsBounds(t *testing.T) {
	for n, ok := range map[int]bool{0: false, 1: true, 50: true, 51: false} {
		p, err := Parse(raw(t, file(n)))
		if ok != (err == nil) || (ok && len(p.Shots) != n) {
			t.Errorf("%d shots: %v", n, err)
		}
	}
}

// Each number within the arena's box and the speeds; rotators whole units in their ranges
func TestRanges(t *testing.T) {
	set := func(path string, v any) map[string]any {
		f := file(1)
		s := f["shots"].([]any)[0].(map[string]any)
		cp := map[string]any{}
		for k, x := range s {
			cp[k] = x
		}
		parts := strings.Split(path, ".")
		switch len(parts) {
		case 1:
			cp[parts[0]] = v
		case 2:
			inner := map[string]any{}
			for k, x := range cp[parts[0]].(map[string]any) {
				inner[k] = x
			}
			inner[parts[1]] = v
			cp[parts[0]] = inner
		case 3:
			inner := map[string]any{}
			for k, x := range cp[parts[0]].(map[string]any) {
				inner[k] = x
			}
			deeper := map[string]any{}
			for k, x := range inner[parts[1]].(map[string]any) {
				deeper[k] = x
			}
			deeper[parts[2]] = v
			inner[parts[1]] = deeper
			cp[parts[0]] = inner
		}
		f["shots"] = []any{cp}
		return f
	}
	for _, c := range []struct {
		path string
		v    any
		ok   bool
	}{
		{"timeLimit", 59.0, true}, {"timeLimit", 59.5, false}, {"timeLimit", -1.0, false}, {"timeLimit", 0.0, true},
		{"ball.location", []any{4096.0, -6000.0, 2044.0}, true}, {"ball.location", []any{4097.0, 20.5, 140.75}, false},
		{"ball.location", []any{10.5, 6001.0, 140.75}, false}, {"ball.location", []any{10.5, 20.5, -1.0}, false},
		{"ball.location", []any{10.5, 20.5, 2045.0}, false}, {"ball.location", []any{10.5, 20.5}, false},
		{"ball.speed", 6000.0, true}, {"ball.speed", 6001.0, false}, {"ball.speed", -1.0, false}, {"ball.speed", "fast", false},
		{"ball.launch.pitch", 16384.0, true}, {"ball.launch.pitch", 16385.0, false}, {"ball.launch.pitch", 0.5, false},
		{"ball.launch.yaw", 65535.0, true}, {"ball.launch.yaw", 65536.0, false}, {"ball.launch.yaw", -1.0, false},
		{"car.startSpeed", 2300.0, true}, {"car.startSpeed", 2301.0, false},
		{"car.rotation.roll", 32768.0, true}, {"car.rotation.roll", 32769.0, false},
		{"car.location", []any{10.5, 20.5, 0.0}, true}, {"car.location", nil, false},
	} {
		_, err := Parse(raw(t, set(c.path, c.v)))
		if c.ok != (err == nil) {
			t.Errorf("%s = %v: %v", c.path, c.v, err)
		}
		if err != nil && code(err) != "pack-invalid" {
			t.Errorf("%s = %v: code %q", c.path, c.v, code(err))
		}
	}
	// (numbers JSON can't hold, or past float64: refused as they're read)
	for _, bad := range []string{`NaN`, `Infinity`, `1e400`, `-1e400`} {
		body := strings.Replace(string(raw(t, file(1))), `"speed":1450`, `"speed":`+bad, 1)
		if _, err := Parse([]byte(body)); err == nil {
			t.Errorf("speed %s: kept", bad)
		}
	}
}

// The schema exactly: a field it doesn't know refused, at the top and inside a shot; its required fields; one value
func TestSchema(t *testing.T) {
	extra := file(1)
	extra["script"] = "anything"
	inner := file(1)
	inner["shots"].([]any)[0].(map[string]any)["ball"].(map[string]any)["spin"] = 3.0
	missing := file(1)
	delete(missing, "type")
	format := file(1)
	format["format"] = 2.0
	id := file(1)
	id["id"] = "../x"
	tags := file(1)
	tags["tags"] = []any{"Aerials", "Aerials"}
	many := file(1)
	many["tags"] = []any{"Aerials", "Bounces", "Shots", "Saves", "Clears"}
	unknown := file(1)
	unknown["tags"] = []any{"Spinning"}
	for name, f := range map[string]map[string]any{"a top field": extra, "a ball's field": inner, "no type": missing, "format 2": format,
		"a bad id": id, "a tag twice": tags, "five tags": many, "an unknown tag": unknown} {
		if _, err := Parse(raw(t, f)); err == nil {
			t.Errorf("%s: kept", name)
		}
	}
	if _, err := Parse(append(raw(t, file(1)), []byte(` {}`)...)); err == nil {
		t.Error("two JSON values: kept")
	}
	if _, err := Parse([]byte(`[]`)); err == nil {
		t.Error("an array: kept")
	}
	// (over MaxBytes: refused before it's read; padded with spaces, so only its size is wrong)
	big := append(raw(t, file(1)), []byte(strings.Repeat(" ", MaxBytes))...)
	if _, err := Parse(big); err == nil || !strings.Contains(err.Error(), "bytes") {
		t.Errorf("oversize: %v", err)
	}
}

// The name and description: printable ASCII within their lengths, the ends' spaces off; the word filter's refusal its
// own code (a stand-in filter: the tests need no word it refuses)
func TestNameAndDescription(t *testing.T) {
	was := allowed
	defer func() { allowed = was }()
	allowed = func(s string) bool { return !strings.Contains(strings.ToLower(s), "forbidden") }
	for name, want := range map[string]string{
		"Abc": "", "  Spaced Out  ": "", strings.Repeat("a", 30): "", "Ab": "pack-name", strings.Repeat("a", 31): "pack-name",
		"Café Drills": "pack-name", "Tab\tName": "pack-name", "Bidi\u202eName": "pack-name", "Zero\u200bWidth": "pack-name",
		"A Forbidden Pack": "pack-name-not-allowed",
	} {
		f := file(1)
		f["name"] = name
		p, err := Parse(raw(t, f))
		if code(err) != want {
			t.Errorf("name %q: %v, want %q", name, err, want)
		}
		if err == nil && p.Name != strings.TrimSpace(name) {
			t.Errorf("name %q kept as %q", name, p.Name)
		}
	}
	for description, want := range map[string]string{"": "", "Fine, with punctuation!": "", strings.Repeat("d", 201): "pack-description",
		"Line\nbreak": "pack-description", "Something forbidden here": "pack-description-not-allowed"} {
		f := file(1)
		f["description"] = description
		if _, err := Parse(raw(t, f)); code(err) != want {
			t.Errorf("description %q: %v, want %q", description, err, want)
		}
	}
}

// The canonical file: the checked fields alone, the shared id, the creator given, the launch's roll 0
func TestFile(t *testing.T) {
	f := file(2)
	f["creator"] = "Whoever They Say"
	p, err := Parse(raw(t, f))
	if err != nil {
		t.Fatal(err)
	}
	out, err := p.File(SharedID("0A1B-2C3D-4E5F-6071"), "Uploader")
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatal(err)
	}
	if back["id"] != "shared-0a1b-2c3d-4e5f-6071" || back["creator"] != "Uploader" || back["format"] != 1.0 || len(back["shots"].([]any)) != 2 {
		t.Errorf("file: %s", out)
	}
	launch := back["shots"].([]any)[0].(map[string]any)["ball"].(map[string]any)["launch"].(map[string]any)
	if launch["roll"] != 0.0 {
		t.Errorf("launch: %v", launch)
	}
	// (the canonical file parses as a pack again)
	if _, err := Parse(out); err != nil {
		t.Errorf("its own file refused: %v", err)
	}
}

// Codes: their shape, fresh each time
func TestCodes(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		c := NewCode()
		if !ValidCode(c) || seen[c] {
			t.Fatalf("code %q", c)
		}
		seen[c] = true
	}
	for _, bad := range []string{"", "0a1b-2c3d-4e5f-6071", "0A1B2C3D4E5F6071", "0A1B-2C3D-4E5F-607", "0A1B-2C3D-4E5F-6071 ", "GA1B-2C3D-4E5F-6071"} {
		if ValidCode(bad) {
			t.Errorf("%q valid", bad)
		}
	}
}

// Keys as encoding/json lets them by refused (RV-1201): one twice (it keeps the last), one in another case (it matches
// without case), at the top and inside a shot; no two of the wire's names alike but for case
func TestStrictKeys(t *testing.T) {
	good := string(raw(t, file(1)))
	if _, err := Parse([]byte(good)); err != nil {
		t.Fatalf("a good pack: %v", err)
	}
	for _, c := range []struct{ what, from, to string }{
		{"a name twice", `"name":`, `"name":"Made Up First","name":`},
		{"its format's key in capitals", `"format":`, `"Format":`},
		{"its name's key in capitals", `"name":`, `"NAME":`},
		{"a shot's ball twice", `"ball":`, `"ball":{},"ball":`},
		{"a shot's car's key in another case", `"startSpeed":`, `"startspeed":`},
	} {
		sent := strings.Replace(good, c.from, c.to, 1)
		if sent == good {
			t.Fatalf("%s: %q not in the pack", c.what, c.from)
		}
		if _, err := Parse([]byte(sent)); code(err) != "pack-invalid" {
			t.Errorf("%s: %v", c.what, err)
		}
	}
	seen := map[string]string{}
	for k := range keyNames {
		if other, ok := seen[strings.ToLower(k)]; ok {
			t.Errorf("%q and %q alike but for case", k, other)
		}
		seen[strings.ToLower(k)] = k
	}
}
