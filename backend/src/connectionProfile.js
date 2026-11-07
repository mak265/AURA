const INTENTIONS = ['Serious relationship', 'Getting to know', 'Still figuring it out'];

function validateConnectionProfile(body) {
  if (body.dating_intention !== undefined && !['', ...INTENTIONS].includes(body.dating_intention)) {
    return 'Choose a valid dating intention.';
  }
  if (body.prompt_answers !== undefined && (
    !Array.isArray(body.prompt_answers) || body.prompt_answers.length !== 3 ||
    body.prompt_answers.some(answer => typeof answer !== 'string' || answer.length > 200)
  )) {
    return 'Provide three prompt answers of up to 200 characters each.';
  }
  return null;
}

async function saveConnectionProfile(db, userId, body) {
  if (body.dating_intention === undefined && body.prompt_answers === undefined) return;
  await db.query(
    'UPDATE auras SET dating_intention = COALESCE($1, dating_intention), prompt_answers = COALESCE($2::jsonb, prompt_answers), updated_at = NOW() WHERE user_id = $3',
    [body.dating_intention ?? null,
      body.prompt_answers === undefined ? null : JSON.stringify(body.prompt_answers.map(answer => answer.trim())),
      userId]
  );
}

module.exports = { validateConnectionProfile, saveConnectionProfile };
