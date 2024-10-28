import React, { useState, useEffect, useRef } from 'react';
import socket from './socket';
import './styles/App.css';
import './styles/ActionBox.css';

const App = () => {
  const [actionMessages, setActionMessages] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [playerId, setPlayerId] = useState(null);
  const [playersInRoom, setPlayersInRoom] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [roomItems, setRoomItems] = useState([]);
  const [username, setUsername] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [input, setInput] = useState('');
  const [roomDescription, setRoomDescription] = useState('');

  const actionBoxRef = useRef(null);
  const chatBoxRef = useRef(null);

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to WebSocket');
    });

    socket.on('chat', (message) => {
      setChatMessages((prevMessages) => [...prevMessages, message]);
    });

    socket.on('command', (message) => {
      setActionMessages((prevMessages) => [...prevMessages, message]);
    });

    socket.on('loginSuccess', ({ description, inventory, player, roomItems }) => {
      setInventory(inventory)
      setRoomDescription(description);
      setPlayerId(player.id);
      setLoggedIn(true);
      setRoomId(player.current_room_id);
      setRoomItems(roomItems);
      setMessage(`Welcome, ${player.username}! You are in room ${player.current_room_id}.`);
    });

    socket.on('loginFailure', (errorMessage) => {
      setMessage(errorMessage);
    });

    socket.on('itemEquipped', (equipMessage) => {
      setMessage(equipMessage);
    });

    // Listen for when the player joins the game
    socket.on('joined', ({ player, roomId }) => {
      setRoomId(roomId);
      setMessage(`You have joined the game in room ${roomId}`);
    });

    // Listen for when another player enters the room
    socket.on('playerJoined', ({ playerId, roomId }) => {
      setPlayersInRoom((prev) => [...prev, playerId]);
      setMessage(`Player ${playerId} has joined room ${roomId}`);
    });

    // Listen for when a player leaves the room
    socket.on('playerLeft', ({ playerId }) => {
      setPlayersInRoom((prev) => prev.filter((id) => id !== playerId));
      setMessage(`Player ${playerId} has left the room`);
    });

    socket.on('updateRoomDescription', (description) => {
      setRoomDescription(description);
    });

    // Listen for successful movement and update room items
    socket.on('moveSuccess', ({ roomId, description, roomItems }) => {
      setRoomId(roomId);
      setRoomDescription(description);
      setRoomItems(roomItems);
      setMessage(`You moved to room ${roomId}`);
    });

    // Listen for item picked up
    socket.on('itemPickedUp', ({ item }) => {
      setInventory((prevInventory) => [...prevInventory, item]);
      setRoomItems((prev) => prev.filter(roomItem => roomItem.id !== item.id));
      setMessage(`You picked up a ${item.name}`);
    });

    socket.on('itemRemoved', ({ itemId }) => {
      // If another player picks up the item, remove it from the room items list
      setRoomItems((prev) => prev.filter(roomItem => roomItem.id !== itemId));
    });

    socket.on('itemAdded', ({ item }) => {
      setRoomItems((prev) => [...prev, item]);
    });

    // Listen for item dropped
    socket.on('itemDropped', ({ item }) => {
      setInventory((prevInventory) => prevInventory.filter((invItem) => invItem.id !== item.id));
      setRoomItems((prev) => [...prev, item]);
      setMessage(`You dropped a ${item.name}`);
    });

    // Listen for item action failure
    socket.on('itemActionFailed', (errorMessage) => {
      setMessage(errorMessage);
    });

    // Listen for move failure
    socket.on('moveFailure', (errMessage) => {
      setMessage(errMessage);
    });

    return () => {
      socket.off('updateRoomDescription');
      socket.off('itemAdded');
      socket.off('loginSuccess');
      socket.off('loginFailure');
      socket.off('joined');
      socket.off('playerJoined');
      socket.off('playerLeft');
      socket.off('moveSuccess');
      socket.off('moveFailure');
      socket.off('itemPickedUp');
      socket.off('itemDropped');
      socket.off('itemRemoved');
      socket.off('itemActionFailed');
      socket.off('itemEquipped');
      socket.off('command');
      socket.off('chat');
    };
  }, []);

  useEffect(() => {
    // Auto-scroll to the bottom when new messages are added
    if (actionBoxRef.current) {
      actionBoxRef.current.scrollTop = actionBoxRef.current.scrollHeight;
    }
  }, [actionMessages]);

  useEffect(() => {
    // Auto-scroll for Chat Box
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleInput = (e) => {
    setInput(e.target.value);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      processInput(input);
      setInput('');
    }
  };

  const validDirections = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'in', 'out', 'up', 'down', 'enter', 'exit']

  const isValidDirection = (direction) => validDirections.includes(direction.toLowerCase())

  const processInput = (input) => {
    if (isValidDirection(input)) {
      socket.emit('command', { type: 'move', direction: input.toLowerCase() });
    } else if (input.startsWith('examine ') || input.startsWith('look at ')) {
      const itemName = input.replace('examine ', '').replace('look at ', '').trim();
      socket.emit('command', { type: 'examine', itemName });
    } else if (input === 'inventory' || input === 'i' || input === 'inv') {
    // Emit the inventory command to the server
      socket.emit('command', { type: 'inventory' });
    } else if (input.startsWith('drop ')) {
      const itemName = input.replace('drop ', '').trim();
      socket.emit('command', { type: 'drop', itemName });
    } else if (input.startsWith('get ') || input.startsWith('pick up ')) {
      const itemName = input.replace('get ', '').replace('pick up ', '').trim();
      socket.emit('command', { type: 'pickup', itemName });
    } else if (input === 'look') {
      socket.emit('command', 'look');
    } else if (input.startsWith('say ')) {
      const message = input.replace('say ', '');
      socket.emit('chat', { type: 'say', message });
    } else if (input.startsWith('`')) {
      const action = input.replace('`', '');
      socket.emit('chat', { type: 'action', message: action });
    } else {
      socket.emit('command', { type: 'error', message: input });
    }
  };

  const handleLogin = () => {
    socket.emit('login', { username, password });
  };

  const handleSendMessage = () => {
      processInput(input);
      setInput('');
  };

  return (
    <div className="App">
      {!loggedIn ? (
        <div>
          <h1>Login to MUD Game</h1>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={handleLogin}>Login</button>
          <p>{message}</p>
        </div>
      ) : (
        <div>
          <h1>MUD Game Interface</h1>
          <p>{message}</p>
            <p>Room Description: {roomDescription}</p>
            <div>
              <h2>Action Box</h2>
              <div className="action-box" ref={actionBoxRef}>
                {actionMessages.map((msg, index) => (
                  <p key={index}>{msg}</p>
                ))}
              </div>
            </div>
            <h2>Chat Box</h2>
            <div className="chat-box" ref={chatBoxRef}>
              {chatMessages.map((msg, index) => (
                <p key={index}>{msg}</p>
              ))}
            </div>
            <div>
              <input
                type="text"
                placeholder="Enter your command..."
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyPress}
              />
              <button onClick={handleSendMessage}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
