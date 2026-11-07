-- AURA Seed Data
-- Run after schema.sql

-- Interests
INSERT INTO interests (name, emoji) VALUES
  ('Music', '🎵'),
  ('Coffee', '☕'),
  ('Gaming', '🎮'),
  ('Hiking', '🥾'),
  ('Art', '🎨'),
  ('Reading', '📚'),
  ('Travel', '✈️'),
  ('Photography', '📷'),
  ('Fitness', '💪'),
  ('Movies', '🎬'),
  ('Food', '🍜'),
  ('Technology', '💻')
ON CONFLICT (name) DO NOTHING;

-- Test users (password for all: password123)
INSERT INTO users (email, password_hash, real_name, age, gender, religion, city, latitude, longitude) VALUES
  ('luna@test.com', '$2a$10$HlrzhAkyIqSO7B.nHIQzkenn5xlCholByWmQkWgEOnSx1IRYMZKtm', 'Luna Reyes', 24, 'Female', 'Catholic', 'Manila', 14.5995, 120.9842),
  ('sol@test.com', '$2a$10$HlrzhAkyIqSO7B.nHIQzkenn5xlCholByWmQkWgEOnSx1IRYMZKtm', 'Sol Mendoza', 26, 'Female', 'Christian', 'Quezon City', 14.6760, 121.0437),
  ('kai@test.com', '$2a$10$HlrzhAkyIqSO7B.nHIQzkenn5xlCholByWmQkWgEOnSx1IRYMZKtm', 'Kai Santos', 28, 'Male', 'Muslim', 'Makati', 14.5547, 121.0244),
  ('aria@test.com', '$2a$10$HlrzhAkyIqSO7B.nHIQzkenn5xlCholByWmQkWgEOnSx1IRYMZKtm', 'Aria Cruz', 22, 'Female', 'Agnostic', 'Pasig', 14.5764, 121.0851),
  ('zen@test.com', '$2a$10$HlrzhAkyIqSO7B.nHIQzkenn5xlCholByWmQkWgEOnSx1IRYMZKtm', 'Zen Tan', 27, 'Nonbinary', 'Buddhist', 'Mandaluyong', 14.5794, 121.0359)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Aura profiles
INSERT INTO auras (user_id, aura_name, aura_color, vibe, bio, emoji) VALUES
  (1, 'MoonAura', 'linear-gradient(135deg,#8B5CF6,#EC4899)', 'Mysterious & Creative', 'Coffee, music and spontaneous adventures.', '🌙'),
  (2, 'SunnyVibe', 'linear-gradient(135deg,#F59E0B,#EF4444)', 'Energetic & Outgoing', 'Always up for an adventure and good food.', '☀️'),
  (3, 'PixelHeart', 'linear-gradient(135deg,#6366F1,#22D3EE)', 'Chill & Gamer', 'Can talk about games and tech for hours.', '🎮'),
  (4, 'CoffeeBean', 'linear-gradient(135deg,#EC4899,#8B5CF6)', 'Cozy & Artistic', 'Lover of cafes, books, and quiet mornings.', '☕'),
  (5, 'Wanderlust', 'linear-gradient(135deg,#22C55E,#22D3EE)', 'Adventurous & Free', 'Collecting memories, not things.', '✈️')
ON CONFLICT (user_id) DO UPDATE SET aura_color = EXCLUDED.aura_color;

-- User interests
INSERT INTO user_interests (user_id, interest_id) VALUES
  (1, 1), (1, 2), (1, 3),  -- MoonAura: Music, Coffee, Gaming
  (2, 1), (2, 7), (2, 11), -- SunnyVibe: Music, Travel, Food
  (3, 3), (3, 12), (3, 1), -- PixelHeart: Gaming, Tech, Music
  (4, 2), (4, 5), (4, 6),  -- CoffeeBean: Coffee, Art, Reading
  (5, 7), (5, 8), (5, 4)   -- Wanderlust: Travel, Photography, Hiking
ON CONFLICT (user_id, interest_id) DO NOTHING;
