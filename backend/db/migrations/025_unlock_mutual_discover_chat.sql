UPDATE matches m
SET soul_game_completed = TRUE
WHERE m.soul_game_completed IS NOT TRUE
  AND EXISTS (SELECT 1 FROM likes l WHERE l.sender_id = m.user1_id AND l.receiver_id = m.user2_id)
  AND EXISTS (SELECT 1 FROM likes l WHERE l.sender_id = m.user2_id AND l.receiver_id = m.user1_id);
