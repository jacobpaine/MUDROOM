const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const app = express();
const httpServer = http.createServer(app);
const { Pool } = require('pg');
const activePlayers = {};
const client = require('./redisClient');

const pool = new Pool({
  user: 'mud_admin',
  host: 'localhost',
  database: 'mud_game',
  password: 'your_password',
  port: 5432,
});

// Example function to get player data
const getPlayer = async (playerId) => {
  const res = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
  return res.rows[0];
};

// Enable CORS for HTTP requests
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST'],
  credentials: true
}));

// Socket.IO server with CORS enabled
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Basic route
app.get('/', (req, res) => {
  res.send('MUD Server is running');
});


const movePlayer = async (playerId, direction) => {

  const playerIdToCurrentRoomId = async (playerId) => {
    try {
      const currentRoomId = await client.hGet(`session:${playerId}`, 'current_room_id');
      if (!currentRoomId) {
        console.error(`Error: session:${playerId}, 'current_room_id' not found in cache.`);
        throw new Error(`${currentRoomId} is not a room.`);
      }
      return currentRoomId;
    } catch (error) {
      console.error('Error fetching current_room_id:', error);
      throw error;
    }
  };

  const roomIdAndDirectionToNewRoomId = async (roomId, direction) => {
    console.log('roomId, direction', roomId, direction)

    const room = await client.hGetAll(`room:${roomId}`);
    if (!room || !room[`${direction}_room_id`]) {
      const roomRes = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      const roomData = roomRes.rows[0];
      if (!roomData ) {
        throw new Error(`Room ${roomId} not found in PostgreSQL either.`);
      }
      // Cache the room in Redis for future use
      await client.hSet(`room:${roomId}`,
        'description', roomData.description,
        'north_room_id', roomData.north_room_id || '',
        'south_room_id', roomData.south_room_id || '',
        'east_room_id', roomData.east_room_id || '',
        'west_room_id', roomData.west_room_id || '',
        'detailed_description', roomData.detailedDescription
      );
      return roomData[`${direction}_room_id`];
    } else {
      return room[`${direction}_room_id`];
    }
  };

  const roomIdToRoomDescription = async (roomId) => {
    try {
      // First, attempt to fetch the room description from the Redis cache
      const room = await client.hGetAll(`room:${roomId}`);
      console.log('room', room)
      if (!room || Object.keys(room).length === 0) {
        console.log(`Room ${roomId} not found in cache, fetching from PostgreSQL...`);
        // If not found in Redis, fetch from PostgreSQL
        const roomRes = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
        const roomData = roomRes.rows[0];
        if (!roomData) {
          throw new Error(`Room ${roomId} not found in PostgreSQL either.`);
        }

        // Cache the room in Redis for future use
        await client.hSet(`room:${roomId}`,
          'description', roomData.description,
          'north_room_id', roomData.north_room_id || '',
          'south_room_id', roomData.south_room_id || '',
          'east_room_id', roomData.east_room_id || '',
          'west_room_id', roomData.west_room_id || '',
          'detailed_description', roomData.detailedDescription
        );

        console.log(`Room ${roomId} fetched from PostgreSQL and cached in Redis.`);
        return roomData.description; // Return the description from PostgreSQL
      }
      console.log(`Room ${roomId} found in cache.`);
      return room.description; // Return the description from Redis
    } catch (error) {
      console.error(`Error fetching room ${roomId}:`, error.message);
      throw error; // Propagate the error to handle it appropriately in the calling function
    }
  };

  const playerIdAndRoomIdUpdatesPlayersCurrentRoom = async (playerId, roomId) => {
    // Update the player's current room in Redis
    return await client.hSet(`session:${playerId}`, 'current_room_id', roomId);
  }

  try {
    const currentRoomId = await playerIdToCurrentRoomId(playerId);
    const newRoomId = await roomIdAndDirectionToNewRoomId(currentRoomId, direction);
    const newRoomDescription = await roomIdToRoomDescription(newRoomId)
    await playerIdAndRoomIdUpdatesPlayersCurrentRoom(playerId, newRoomId)
    if (newRoomId) {
      return { success: true, newRoomId, description: newRoomDescription };
    } else {
      return { success: false, message: 'No exit in that direction' };
    }
  } catch (error) {
    // Handle any errors
    console.error('Error in movePlayer:', error.message);
    return { success: false, message: error.message };
  }
};

// Pick up an item
const pickUpItem = async (playerId, itemId) => {
  // Check if the item is in the player's current room
  const itemRes = await pool.query('SELECT * FROM items WHERE id = $1 AND current_room_id IS NOT NULL', [itemId]);
  const item = itemRes.rows[0];

  if (item) {
    // Update the item to be held by the player
    await pool.query('UPDATE items SET held_by_player_id = $1, current_room_id = NULL WHERE id = $2', [playerId, itemId]);
    return { success: true, item };
  } else {
    return { success: false, message: 'Item not found in the room' };
  }
};

// Drop an item
const dropItem = async (playerId, itemId) => {
  // Check if the player is holding the item
  const itemRes = await pool.query('SELECT * FROM items WHERE id = $1 AND held_by_player_id = $2', [itemId, playerId]);
  const item = itemRes.rows[0];

  if (item) {
    // Get the player's current room
    const playerRes = await pool.query('SELECT current_room_id FROM players WHERE id = $1', [playerId]);
    const currentRoomId = playerRes.rows[0].current_room_id;

    // Update the item to be in the current room
    await pool.query('UPDATE items SET held_by_player_id = NULL, current_room_id = $1 WHERE id = $2', [currentRoomId, itemId]);

    return { success: true, item };
  } else {
    return { success: false, message: 'Player is not holding this item' };
  }
};

// Get items in the room
const getRoomItems = async (roomId) => {
  const itemsRes = await pool.query('SELECT * FROM items WHERE current_room_id = $1', [roomId]);
  return itemsRes.rows;
};


// Pure function to format the room description, adding the available exits
const formatRoomDescription = (description, exits) => {
  const exitsText = exits.length > 0
    ? ` Obvious exits are: ${exits.join(', ')}.`
    : ' There are no obvious exits.';

  return `${description}${exitsText}`;
};

const roomIdToRoom = async (roomId) => {
  const roomRes = await pool.query('SELECT description, north_room_id, south_room_id, east_room_id, west_room_id FROM rooms WHERE id = $1', [roomId]);
  return roomRes.rows[0];
}

const roomIdToItems = async (roomId) => {
  const itemsRes = await pool.query('SELECT name FROM items WHERE current_room_id = $1', [roomId]);
  return itemsRes.rows;
}

const roomIdAndPlayerIdToPlayers = async (roomId, playerId) => {
  const playersRes = await pool.query('SELECT username FROM players WHERE current_room_id = $1 AND id != $2', [roomId, playerId]);
  return playersRes.rows;
}

const descriptionAndItemsToDescription = (description, items) => {
  if (items.length > 0) {
    const itemList = items.map(item => item.name).join(', ');
    return `${description} You see: ${itemList}.`;
  }
  return description;
}

const descriptionAndPlayersToDescription = (description, players) => {
  if (players.length > 0) {
    const playerList = players.map(player => player.username).join(', ');
    return `${description} You notice: ${playerList}.`;
  } else {
    return `${description} You are alone here.`;
  }
}

const roomToExits = (room) => {
  const exits = [];
  if (room.north_room_id) exits.push('north');
  if (room.south_room_id) exits.push('south');
  if (room.east_room_id) exits.push('east');
  if (room.west_room_id) exits.push('west');
  return exits;
}

// Main function to get the room description, now fully functional
const roomIdAndPlayerIdToRoomDescription = async (roomId, currentPlayerId) => {
  const room = await roomIdToRoom(roomId);
  const items = await roomIdToItems(roomId);
  const players = await roomIdAndPlayerIdToPlayers(roomId, currentPlayerId)
  const descriptionWithItems = descriptionAndItemsToDescription(room.description, items)
  const descriptionWithPlayers = descriptionAndPlayersToDescription(descriptionWithItems, players)
  const exits = roomToExits(room);
  return formatRoomDescription(descriptionWithPlayers, exits);
};

// Equip an item from the player's inventory
const equipItem = async (playerId, itemId) => {
  // Fetch the item and player
  const itemRes = await pool.query('SELECT * FROM items WHERE id = $1 AND held_by_player_id = $2', [itemId, playerId]);
  const playerRes = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
  const item = itemRes.rows[0];
  const player = playerRes.rows[0];
  if (!item || !player) {
    return { success: false, message: 'Invalid player or item' };
  }

  // Update player stats based on the item being equipped
  const updatedAttack = player.strength + item.attack_bonus;
  const updatedDefense = player.defense + item.defense_bonus;
  const updatedAgility = player.agility + item.agility_bonus;

  // Update the player’s stats in the database
  await pool.query('UPDATE players SET strength = $1, defense = $2, agility = $3 WHERE id = $4',
    [updatedAttack, updatedDefense, updatedAgility, playerId]);

  return { success: true, message: `You equipped the ${item.name}.` };
};

const useItem = async (playerId, itemId) => {
  // Fetch the item and player
  const itemRes = await pool.query('SELECT * FROM items WHERE id = $1 AND held_by_player_id = $2', [itemId, playerId]);
  const playerRes = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
  const item = itemRes.rows[0];
  const player = playerRes.rows[0];
  if (!item || !player) {
    return { success: false, message: 'Invalid player or item' };
  }
  if (item.use_effect === 'heal') {
    const newHealth = Math.min(player.health + item.effect_value, 100);  // Cap health at 100
    await pool.query('UPDATE players SET health = $1 WHERE id = $2', [newHealth, playerId]);
    return { success: true, message: `You used a ${item.name} and restored ${item.effect_value} health.` };
  }
};

const playerIdToSessionData = async (playerId) => {
  const sessionData = await client.hGetAll(`session:${playerId}`, (err, data) => {
    if (err || !data) {
      console.error('Session not found in Redis:', err);
      // If Redis fails, fall back to database (optional)
      return;
    }
    console.log('data', data)
    return data
  });
  return sessionData;
}

io.on('connection', async (socket) => {
  console.log('A user connected');

  socket.on('command', async (command) => {
    const playerId = activePlayers[socket.id]?.playerId;

    if (command.type === 'error') {
      socket.emit('command', `Sorry, what is: "${command.message}" ?`);
    }

    if (playerId) {
      const playerData = await playerIdToSessionData(playerId)
      const { roomId } = playerData;

      if (playerData && command.type === 'move') {
        const { playerId } = playerData
        const { direction } = command
        console.log('Moving Player ID:', playerId);
        const result = await movePlayer(playerId, direction);
        if (result.success) {
          const oldRoomId = activePlayers[socket.id].roomId;
          const newRoomId = result.newRoomId;

          // Update player's current room
          activePlayers[socket.id].roomId = newRoomId;

          // Leave the old room and join the new one
          socket.leave(`room_${oldRoomId}`);
          socket.join(`room_${newRoomId}`);

          // Notify others about the movement
          socket.to(`room_${oldRoomId}`).emit('playerLeft', { playerId });
          socket.to(`room_${newRoomId}`).emit('playerJoined', { playerId, roomId: newRoomId });

          socket.emit('moveSuccess', { roomId: newRoomId, description: result.description });

          // Fetch items and description in the new room
          const roomDescription = await roomIdAndPlayerIdToRoomDescription(newRoomId, playerId);
          const roomItems = await getRoomItems(newRoomId);

          // Notify the player about the new room and its items
          socket.emit('moveSuccess', { roomId: newRoomId, description: roomDescription, roomItems });
        } else {
          socket.emit('moveFailure', result.message);
        }
      }

      if (playerData && command.type === 'examine') {
        const input = command.itemName.toLowerCase().split(' ')[0];
        try {
          let inventoryPartRes = await pool.query(`
            SELECT i.name, p.part_description
            FROM items i
            JOIN item_parts p ON i.id = p.item_id
            WHERE lower(p.part_name) = $1 AND i.held_by_player_id = $2
          `, [input, playerData.playerId]);

          if (inventoryPartRes.rows.length > 0) {
            const partDescription = inventoryPartRes.rows[0].part_description;
            const itemName = inventoryPartRes.rows[0].name;
            socket.emit('command', `You look at the ${input} of the ${itemName}: ${partDescription}`);
            return;
          }

          // Step 2: If the part is not in the inventory, check in the room
          let itemInRoom = await pool.query(`
            SELECT i.detailed_description
            FROM items i
            WHERE lower(i.name) = $1 AND i.current_room_id = $2;
          `, [input, roomId]);
          if (itemInRoom.rows.length > 0) {
            const description = itemInRoom.rows[0].detailed_description;
            socket.emit('command', `${description}`);
            return;
          }
          // If the part isn't found in either the inventory or the room
          socket.emit('command', `You don't see anything with a ${input} to examine.`);
        } catch (error) {
          console.error('Error examining part:', error);
          socket.emit('command', 'Nothing to see here.');
        }
      }

      if (playerData && command === 'look') {
        const roomId = playerData.roomId;
        try {
          // Fetch additional room description
          const roomRes = await pool.query('SELECT detailed_description FROM rooms WHERE id = $1', [roomId]);
          // Check if the detailed description exists
          if (roomRes.rows.length > 0 && roomRes.rows[0].detailed_description) {
            const detailedDescription = roomRes.rows[0].detailed_description;
            // Send the detailed room description back to the player
            socket.emit('command', `You look around: ${detailedDescription}`);
          } else {
            // If no detailed description is available, send a fallback message
            socket.emit('command', `You look around but don't notice anything unusual.`);
          }
        } catch (error) {
          // Handle any database errors or unexpected issues
          console.error('Error fetching room details:', error);
          socket.emit('command', 'There was an error trying to look around. Please try again later.');
        }
      }

      if (playerData && command.type === 'inventory') {
        try {
          // Fetch the player's inventory from the database
          const inventoryRes = await pool.query('SELECT name FROM items WHERE held_by_player_id = $1', [playerData.playerId]);
          const inventoryItems = inventoryRes.rows;

          if (inventoryItems.length > 0) {
            const itemList = inventoryItems.map(item => item.name).join(', ');
            socket.emit('command', `You are carrying: ${itemList}`);
          } else {
            socket.emit('command', 'Your inventory is empty.');
          }
        } catch (error) {
          console.error('Error fetching inventory:', error);
          socket.emit('command', 'There was an error fetching your inventory. Please try again later.');
        }
      }

      if (playerData && command.type === 'pickup') {
        const roomId = playerData.roomId;
        const itemName = command.itemName.toLowerCase();

        try {
          // Check if the item is in the current room
          const itemRes = await pool.query('SELECT * FROM items WHERE lower(name) = $1 AND current_room_id = $2', [itemName, roomId]);

          if (itemRes.rows.length > 0) {
            const item = itemRes.rows[0];

            // Update the item to be in the player's inventory (remove it from the room)
            await pool.query('UPDATE items SET held_by_player_id = $1, current_room_id = NULL WHERE id = $2', [playerData.playerId, item.id]);
            await pool.query('INSERT INTO player_inventory (player_id, item_id) SELECT $1, id FROM items WHERE lower(name) = $2', [playerData.playerId, command.itemName]);

            playerData.inventory.push(command.itemName);
            // Send confirmation message back to the player
            socket.emit('command', `You pick up: ${item.name}`);
            // Update the room description after picking up the item
            const updatedRoomDescription = await roomIdAndPlayerIdToRoomDescription(roomId, playerData.playerId);
            io.to(`room_${roomId}`).emit('updateRoomDescription', updatedRoomDescription);

          } else {
            socket.emit('command', `There is no ${itemName} here.`);
          }
        } catch (error) {
          console.error('Error fetching item:', error);
          socket.emit('command', 'There was an error trying to pick up the item. Please try again later.');
        }
      }

      if (playerData && command.type === 'drop') {
        const itemName = command.itemName.toLowerCase();
        const roomId = playerData.roomId;

        try {
          // Check if the player has the item in their inventory
          const itemRes = await pool.query('SELECT * FROM items WHERE lower(name) = $1 AND held_by_player_id = $2', [itemName, playerData.playerId]);

          if (itemRes.rows.length > 0) {
            const item = itemRes.rows[0];
            // Update the item to be placed back into the room (remove it from the player's inventory)
            await pool.query('DELETE FROM player_inventory WHERE player_id = $1 AND item_id = (SELECT id FROM items WHERE lower(name) = $2)', [playerData.playerId, command.itemName]);
            await pool.query('UPDATE items SET held_by_player_id = NULL, current_room_id = $1 WHERE id = $2', [roomId, item.id]);
            playerData.inventory = playerData.inventory.filter(item => item !== command.itemName);
            // Send confirmation to the player
            socket.emit('command', `You drop: ${item.name}`);
            // Regenerate and emit the updated room description**
            const updatedRoomDescription = await roomIdAndPlayerIdToRoomDescription(roomId, playerData.playerId);
            io.to(`room_${roomId}`).emit('updateRoomDescription', updatedRoomDescription);
          } else {
            socket.emit('command', `You are not carrying ${itemName}.`);
          }
        } catch (error) {
          console.error('Error dropping item:', error);
          socket.emit('command', 'There was an error trying to drop the item. Please try again later.');
        }
      }
    };

  });

  // Handle chat and emotes
  socket.on('chat', ({ type, message }) => {
    const playerData = activePlayers[socket.id];
    if (playerData) {
      const playerName = playerData.username || `Player ${playerData.playerId}`;
      let formattedMessage;

      if (type === 'say') {
        formattedMessage = `${playerName} says: "${message}"`;
      } else if (type === 'action') {
        formattedMessage = `${playerName} ${message}`;
      }

      // Broadcast chat to all players in the room
      const roomId = playerData.roomId;
      io.to(`room_${roomId}`).emit('chat', formattedMessage);
    }
  });

  // Handle player login
  socket.on('login', async ({ username, password }) => {
    try {
      // Fetch player profile from the database
      const playerRes = await pool.query('SELECT * FROM players WHERE username = $1 AND password = $2', [username, password]);
      const playerData = playerRes.rows[0];
      const playerId = playerData.id;
      if (playerData) {
        // Load player inventory
        const playerInventory = await pool.query('SELECT i.name FROM items i JOIN player_inventory pi ON i.id = pi.item_id WHERE pi.player_id = $1', [playerId]);
        const inventoryItems = playerInventory.rows.map(row => row.name);
        await client.hSet(`session:${playerId}`,
          'playerId', playerData.id,
          'roomId', playerData.current_room_id,
          'health', playerData.health,
          'level', playerData.level,
          'inventory', JSON.stringify(inventoryItems),
        );

        // Set the player’s initial state
        activePlayers[socket.id] = {
          playerId,
          roomId: playerData.current_room_id,
          health: playerData.health,
          level: playerData.level,
          inventory: inventoryItems,
        };

        socket.join(`room_${playerData.current_room_id}`);

        // Fetch the items in the room the player is logging into
        const roomItemsRes = await pool.query('SELECT * FROM items WHERE current_room_id = $1', [playerData.current_room_id]);
        const roomItems = roomItemsRes.rows;
        const roomDescription = await roomIdAndPlayerIdToRoomDescription(playerData.current_room_id, playerId);

        // Fetch the items held by the player (the player's inventory)
        const inventoryRes = await pool.query('SELECT * FROM items WHERE held_by_player_id = $1', [playerData.id]);
        const inventory = inventoryRes.rows;

        // Notify the player and others in the room
        socket.emit('loginSuccess', { player:playerData, roomId: playerData.current_room_id, description: roomDescription, roomItems, inventory });

        socket.to(`room_${playerData.current_room_id}`).emit('playerJoined', { playerId, roomId: playerData.current_room_id });

        console.log(`Player ${playerId} logged in successfully.`);
      } else {
        socket.emit('loginFailure', 'Invalid username or password');
      }
    } catch (error) {
      console.error('Error during login:', error);
      socket.emit('error', 'An error occurred during login');
    }
  });

  socket.on('joinGame', async (playerId) => {
    // Track new player joining
    const res = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
    const player = res.rows[0];
    console.log('player', player)
    console.log('playerId', playerId)
    if (player) {
      activePlayers[socket.id] = { playerId, roomId: player.current_room_id };
      socket.join(`room_${player.current_room_id}`); // Join the room
      socket.emit('joined', { player, roomId: player.current_room_id });
      socket.to(`room_${player.current_room_id}`).emit('playerJoined', { playerId, roomId: player.current_room_id });
    } else {
      socket.emit('error', 'Player not found');
    }
  });

  // Handle action messages like "say" or actions
  socket.on('actionMessage', ({ type, message }) => {
    const playerData = activePlayers[socket.id];

    if (playerData) {
      const playerName = playerData.username || `Player ${playerData.playerId}`;
      let formattedMessage;

      if (type === 'say') {
        formattedMessage = `${playerName} says: "${message}"`;
      } else if (type === 'action') {
        formattedMessage = `${playerName} ${message}`;
      }

      // Broadcast the message to all players in the room
      const roomId = playerData.roomId;
      io.to(`room_${roomId}`).emit('actionMessage', formattedMessage);
    }
  });

  socket.on('useItem', async ({ playerId, itemId }) => {
    const result = await useItem(playerId, itemId);
    socket.emit('itemUsed', result.message);
  });

  socket.on('equipItem', async ({ playerId, itemId }) => {
    const result = await equipItem(playerId, itemId);
    socket.emit('itemEquipped', result.message);
  });

  // Handle picking up an item
  socket.on('pickUpItem', async ({ playerId, itemId }) => {
    const result = await pickUpItem(playerId, itemId);
    if (result.success) {
      const roomId = activePlayers[socket.id].roomId;
      // Emit event to update the player's inventory and remove the item from the room for all players
      socket.emit('itemPickedUp', { item: result.item });  // Notify the player picking up the item
      socket.to(`room_${roomId}`).emit('itemRemoved', { itemId });  // Notify all other players in the room
    } else {
      socket.emit('itemActionFailed', result.message);
    }
  });

  socket.on('disconnect', async () => {
    const playerData = activePlayers[socket.id];
    const playerId = activePlayers[socket.id]?.playerId;
    const roomId = activePlayers[socket.id]?.roomId;

    if (playerData) {
      try {
        // Save player's current state to the database
        await pool.query('UPDATE players SET current_room_id = $1, health = $2, level = $3 WHERE id = $4', [
          playerData.roomId,
          playerData.health,
          playerData.level,
          playerData.playerId,
        ]);

        // Save player inventory
        await pool.query('DELETE FROM player_inventory WHERE player_id = $1', [playerData.playerId]);
        for (let itemName of playerData.inventory) {
          const itemRes = await pool.query('SELECT id FROM items WHERE name = $1', [itemName]);
          await pool.query('INSERT INTO player_inventory (player_id, item_id) VALUES ($1, $2)', [playerData.playerId, itemRes.rows[0].id]);
        }
      } catch (error) {
        console.error('Error saving player state:', error);
      }
    }

    if (playerId && roomId) {
      // Notify other players
      socket.to(`room_${roomId}`).emit('playerLeft', { playerId });
      delete activePlayers[socket.id];
    }
    console.log('User disconnected');
  });
});

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
