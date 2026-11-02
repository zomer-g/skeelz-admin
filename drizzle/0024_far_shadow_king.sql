CREATE TABLE "smoov_pushed" (
	"email" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
