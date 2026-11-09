-- Migration: add validation_error column to prospects
ALTER TABLE prospects ADD COLUMN validation_error text;
