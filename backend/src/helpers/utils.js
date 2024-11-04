const generateRandom8DigitNumber = () => {
  return Math.floor(10000000 + Math.random() * 90000000);
};

const attributesIdToAttributes = (attributesId) => {

  try {
    const userResult = await pool.query('SELECT attributes_id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }
    return userResult.rows[0].attributes_id;
  } catch (error) {
    console.error('Error fetching attributes_id:', error);
    throw error;
  }

};

module.exports = {
  generateRandom8DigitNumber,
};
