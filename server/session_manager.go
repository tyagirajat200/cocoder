package server

import (
	"bytes"
	"encoding/gob"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/go-redis/redis"
	"github.com/google/uuid"
	"github.com/sergi/go-diff/diffmatchpatch"
)

var (
	sessionExpiry = time.Hour * 24 * 7

	nowSource = time.Now
)

const (
	cursorSpecialSequence = "阳цąß"
)

func init() {
	gob.Register(&Session{})
	gob.Register(&User{})
}

type SessionID string

type SessionManager struct {
	c *redis.Client
}

type User struct {
	ID       string    `diff:"ID"`
	Position int       `diff:"Position"`
	LastEdit time.Time `diff:"LastEdit"`
}

type Session struct {
	Text     string    `diff:"Text"`
	Language string    `diff:"Language"`
	LastEdit time.Time `diff:"LastEdit"`

	Users map[string]*User `diff:"Users"`
}

func NewSessionManager(c *redis.Client) *SessionManager {
	if _, err := c.Ping().Result(); err != nil {
		log.Fatalf(fmt.Sprintf("Could not connect to redis: %v", err))
	}

	return &SessionManager{
		c: c,
	}
}

func (m *SessionManager) NewSession() SessionID {
	newSessionID := SessionID(uuid.New().String())
	if err := m.c.Set(string(newSessionID), serializeSession(&Session{
		Language: "plaintext",
		Users:    make(map[string]*User),
	}), sessionExpiry).Err(); err != nil {
		log.Printf("Could not create the session: %v", err)
		return ""
	}
	return newSessionID
}

func (m *SessionManager) LoadSession(session SessionID) (*Session, error) {
	if exists, err := m.c.Exists(string(session)).Result(); err != nil && err != redis.Nil {
		return nil, fmt.Errorf("failed to check if session '%s' exists", session)
	} else if exists == 0 {
		return nil, fmt.Errorf("session '%s' does not exist", session)
	}
	if val, err := m.c.Get(string(session)).Result(); err != nil && err != redis.Nil {
		return nil, fmt.Errorf("failed to load session '%s'", session)
	} else {
		return deserializeSession(val), nil
	}
}

func updateSessionTextProcessor(reqInt interface{}, s *Session) interface{} {
	req := reqInt.(*UpdateSessionRequest)
	if req.CursorPos < 0 || req.CursorPos > len(req.NewText) {
		req.CursorPos = 0
	}

	wasMerged := req.BaseText != s.Text

	req.NewText = req.NewText[:req.CursorPos] + cursorSpecialSequence + req.NewText[req.CursorPos:]

	dmp := diffmatchpatch.New()
	userPatches := dmp.PatchMake(dmp.DiffMain(req.BaseText, req.NewText, false))
	textWithCursor, _ := dmp.PatchApply(userPatches, s.Text)

	newCursorPos := strings.Index(textWithCursor, cursorSpecialSequence)
	s.Text = strings.ReplaceAll(textWithCursor, cursorSpecialSequence, "")

	now := nowSource()

	s.LastEdit = now

	if user, ok := s.Users[req.UserID]; ok {
		user.Position = newCursorPos
		user.LastEdit = now
	} else {
		s.Users[req.UserID] = &User{
			ID:       req.UserID,
			Position: newCursorPos,
			LastEdit: now,
		}
	}

	otherUsers := []OtherUser{}

	for _, u := range s.Users {
		if u.ID == req.UserID || now.Sub(u.LastEdit) > time.Minute {
			continue
		}
		otherUsers = append(otherUsers, OtherUser{
			ID:        u.ID,
			CursorPos: u.Position,
		})
	}

	return &UpdateSessionResponse{
		NewText:    s.Text,
		CursorPos:  newCursorPos,
		WasMerged:  wasMerged,
		Language:   s.Language,
		OtherUsers: otherUsers,
	}
}

func serializeSession(s *Session) string {
	b := new(bytes.Buffer)
	e := gob.NewEncoder(b)
	if err := e.Encode(s); err != nil {
		panic(fmt.Sprintf("Failed to encode session (%v): %v", s, err))
	}
	return b.String()
}

func deserializeSession(s string) *Session {
	res := &Session{}
	b := bytes.NewBuffer([]byte(s))
	d := gob.NewDecoder(b)
	if err := d.Decode(res); err != nil {
		panic(fmt.Sprintf("Failed to decode session (%v): %v", s, err))
	}
	return res
}

type requestProcessor = func(req interface{}, s *Session) interface{}

func (m *SessionManager) modifySession(sessionID SessionID, req interface{}, processor requestProcessor) (interface{}, error) {
	resp := *new(interface{})
	if err := m.c.Watch(func(tx *redis.Tx) error {
		ss, err := tx.Get(string(sessionID)).Result()
		if err != nil && err != redis.Nil {
			return err
		}
		session := deserializeSession(ss)

		_, err = tx.Pipelined(func(pipe redis.Pipeliner) error {
			resp = processor(req, session)
			pipe.Set(string(sessionID), serializeSession(session), sessionExpiry)
			return nil
		})
		return err
	}, string(sessionID)); err != nil {
		return nil, fmt.Errorf("failed to modify session '%s': %v", sessionID, err)
	}

	return resp, nil
}

func (m *SessionManager) UpdateSessionText(sessionID SessionID, req *UpdateSessionRequest) (*UpdateSessionResponse, error) {
	resp, err := m.modifySession(sessionID, req, updateSessionTextProcessor)
	if err != nil {
		return nil, err
	}
	return resp.(*UpdateSessionResponse), nil
}

func updateLanguageProcessor(reqInt interface{}, s *Session) interface{} {
	req := reqInt.(*UpdateLanguageRequest)
	s.Language = req.Language
	return nil
}

func (m *SessionManager) UpdateLanguage(sessionID SessionID, req *UpdateLanguageRequest) error {
	_, err := m.modifySession(sessionID, req, updateLanguageProcessor)
	return err
}
