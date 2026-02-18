function parseOrRespond(schema, payload, res) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }));

    res.status(400).json({
      message: 'Validation failed',
      errors: issues
    });

    return null;
  }

  return parsed.data;
}

module.exports = {
  parseOrRespond
};