package models

type Poll struct {
	ID         int            `json:"id" bson:"id"`
	Question   string         `json:"question" bson:"question"`
	Options    []string       `json:"options" bson:"options"`
	VoteCounts map[string]int `json:"vote_counts" bson:"vote_counts"`
	CreatedBy  string         `json:"created_by" bson:"created_by"`
	CreatorName string        `json:"creator_name" bson:"creator_name"`
}
