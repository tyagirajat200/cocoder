package server

import (
	"strings"
	"testing"

	"github.com/alicebob/miniredis"
	"github.com/go-redis/redis"
	"github.com/r3labs/diff/v2"
)

func TestNewSession(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to setup miniredis: %v", err)
	}
	sm := NewSessionManager(redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	}))
	createdIDs := make(map[SessionID]interface{})
	for i := 0; i < 100; i++ {
		newID := sm.NewSession()
		if _, ok := createdIDs[newID]; ok {
			t.Errorf("session IDs should not duplicate, but %s did", newID)
		}
		createdIDs[newID] = new(interface{})
	}
}

func TestLoadSession(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to setup miniredis: %v", err)
	}
	sm := NewSessionManager(redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	}))

	sampleText := "abc"

	s := sm.NewSession()
	sm.UpdateSessionText(s, EditState{NewText: sampleText})

	text, err := sm.LoadSession(s)
	if err != nil {
		t.Errorf("Session does not exist, but should: %v", err)
	}
	if text != sampleText {
		t.Errorf("Session got wrong text, want: %v, got: %v", sampleText, text)
	}

	s = "abc"

	if _, err := sm.LoadSession(s); err == nil {
		t.Errorf("Session '%v' should not exist but does", s)
	}
}

func editStateFromString(es string) EditState {
	i := strings.Index(es, "|")
	return EditState{
		NewText:   strings.Replace(es, "|", "", 1),
		CursorPos: i,
	}
}

func TestUpdateSessionText(t *testing.T) {
	for _, tc := range []struct {
		name            string
		initialState    string
		clientBase      string
		clientEditState string
		wantEditState   string
	}{{
		name:            "append_to_empty",
		clientEditState: "abc|",
		wantEditState:   "abc|",
	}, {
		name: "simultaneous_edit",
		initialState: `Here's something original
	
		animal of the year is:
		fruit of the year is: banana
		`,
		clientBase: `Here's something original
	
		animal of the year is:
		fruit of the year is:
		`,
		clientEditState: `Here's something original
	
		animal of the year is: gorilla|
		fruit of the year is:
		`,
		wantEditState: `Here's something original
	
		animal of the year is: gorilla|
		fruit of the year is: banana
		`,
	}, {
		name: "cursor_at_whitespaces",
		clientEditState: `abc
		
		
		|`,
		wantEditState: `abc
		
		
		|`,
	}} {
		t.Run(tc.name, func(t *testing.T) {
			mr, err := miniredis.Run()
			if err != nil {
				t.Fatalf("Failed to setup miniredis: %v", err)
			}
			sm := NewSessionManager(redis.NewClient(&redis.Options{
				Addr: mr.Addr(),
			}))
			s := sm.NewSession()

			if _, err := sm.UpdateSessionText(s, EditState{NewText: tc.initialState}); err != nil {
				t.Fatalf("Initial edit should not fail, but did: %v", err)
			}

			es := editStateFromString(tc.clientEditState)
			es.BaseText = tc.clientBase

			resEs, err := sm.UpdateSessionText(s, es)
			if err != nil {
				t.Fatalf("Test edit fail, but shouldn't: %v", err)
			}
			wantEs := editStateFromString(tc.wantEditState)

			changelog, err := diff.Diff(resEs, wantEs)
			if err != nil {
				t.Fatalf("Diffing failed, but shouldn't: %v", err)
			}

			if len(changelog) > 0 {
				t.Errorf("Following changes were detected:\n%v", changelog)
			}
		})
	}
}
