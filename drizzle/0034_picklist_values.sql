CREATE TABLE "sf_picklist_value" (
	"object" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sf_picklist_value_object_field_value_pk" PRIMARY KEY("object","field","value")
);
