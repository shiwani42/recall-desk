CREATE TABLE `case_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer NOT NULL,
	`type` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recall_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recall_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`sku` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recall_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recall_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`sale_item_id` integer NOT NULL,
	`sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`refund_amount_cents` integer NOT NULL,
	`recommended_remedy` text NOT NULL,
	`refund_rail` text NOT NULL,
	`recommendation_reason` text NOT NULL,
	`chosen_remedy` text,
	`status` text DEFAULT 'identified' NOT NULL,
	`buyer_token` text NOT NULL,
	`resolution` text,
	`notified_at` integer,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`recall_id`) REFERENCES `recalls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recall_cases_buyer_token_unique` ON `recall_cases` (`buyer_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `recall_cases_recall_item_uq` ON `recall_cases` (`recall_id`,`sale_item_id`);--> statement-breakpoint
CREATE TABLE `recall_skus` (
	`recall_id` text NOT NULL,
	`sku` text NOT NULL,
	PRIMARY KEY(`recall_id`, `sku`),
	FOREIGN KEY (`recall_id`) REFERENCES `recalls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recalls` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`hazard` text NOT NULL,
	`severity` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`remedies` text NOT NULL,
	`replacement_stock` integer,
	`sold_from` integer,
	`sold_to` integer,
	`source_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sale_items_sku_idx` ON `sale_items` (`sku`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`paypal_order_id` text,
	`capture_id` text,
	`buyer_name` text,
	`buyer_email` text,
	`ship_address` text,
	`total_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`captured_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_capture_id_unique` ON `sales` (`capture_id`);--> statement-breakpoint
CREATE INDEX `sales_captured_at_idx` ON `sales` (`captured_at`);