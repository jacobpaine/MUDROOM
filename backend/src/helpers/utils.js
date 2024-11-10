const {
  optionsToAttributesCreateQuery,
  optionsToAttributesUpdateQuery,
} = require("./attributes");

const {
  optionsToDescriptionsCreateQuery,
  optionsToDescriptionUpdateQuery,
} = require("./descriptions");

const { optionsToRoomUpdateQuery } = require("./rooms");

const generateRandom8DigitNumber = () => {
  return Math.floor(10000000 + Math.random() * 90000000);
};

const optionsAndTableNameToCreateQuery = (options, tableName) => {
  const queryBlock = {
    attributes: optionsToAttributesCreateQuery(options),
    descriptions: optionsToDescriptionsCreateQuery(options),
    inventory: optionsToInventoryCreateQuery(options),
    npcs: optionsToNpcsCreateQuery(options),
    rooms: optionsToRoomsCreateQuery(options),
    users: optionsToUsersCreateQuery(options),
  };
  return queryBlock[tableName];
};

const tableNameToReadQuery = (tableName) => {
  const queryBlock = {
    attributes: "SELECT attributes_id FROM users WHERE id = $1",
    current_room: "SELECT current_room_id FROM rooms WHERE id = $1",
    description: "SELECT description_id FROM descriptions WHERE id = $1",
    inventory: "SELECT inventory_id FROM inventory WHERE id = $1",
    npcs: "SELECT npc_id FROM npcs WHERE id = $1",
    users: "SELECT username FROM users WHERE id = $1",
  };
  return queryBlock[tableName];
};

const optionsAndTableNameToUpdateQuery = (options, tableName) => {
  const queryBlock = {
    attributes: optionsToAttributesUpdateQuery(options),
    descriptions: optionsToDescriptionUpdateQuery(options),
    inventory: optionsToInventoryUpdateQuery(options),
    npcs: optionsToNpcUpdateQuery(options),
    rooms: optionsToRoomUpdateQuery(options),
    users: optionsToUsersUpdateQuery(options),
  };
  return queryBlock[tableName];
};

const idAndOptionsAndTableNameToCreateResult = async (
  id,
  options,
  tableName
) => {
  const query = optionsAndTableNameToCreateQuery(options, tableName);
  try {
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      throw new Error(`No results found for ${tableName} with id ${id}`);
    }
    return result.rows[0];
  } catch (error) {
    console.error(
      `Error executing query on ${tableName} with id ${id}:`,
      error
    );
    throw error;
  }
};

const idAndTableNameToReadResult = async (id, tableName) => {
  const query = tableNameToReadQuery(tableName);
  try {
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      throw new Error(`${tableName} not found`);
    }
    return result.rows[0];
  } catch (error) {
    console.error("Error fetching attributes_id:", error);
    throw error;
  }
};

const idAndOptionsAndTableNameToUpdateResult = async (
  id,
  options,
  tableName
) => {
  const query = optionsAndTableNameToUpdateQuery(options, tableName);
  try {
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      throw new Error(`No results found for ${tableName} with id ${id}`);
    }
    return result.rows[0];
  } catch (error) {
    console.error(
      `Error executing query on ${tableName} with id ${id}:`,
      error
    );
    throw error;
  }
};

module.exports = {
  generateRandom8DigitNumber,
  idAndOptionsAndTableNameToCreateResult,
  idAndOptionsAndTableNameToUpdateResult,
  idAndTableNameToReadResult,
};
