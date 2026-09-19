package models

import "go.mongodb.org/mongo-driver/v2/bson"

type Vote struct {
	ID     bson.ObjectID `bson:"_id,omitempty" json:"id"`
	PollID int           `bson:"poll_id" json:"poll_id"`
	UserID string        `bson:"user_id" json:"user_id"`
	Option string        `bson:"option" json:"option"`
}