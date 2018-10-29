/* http://localhost:1234/ */
const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const app = express();
const server = http.Server(app);
const io = socketIO(server);
const port = 1234;

app.set('port', port);
app.use('/static', express.static(__dirname + '/static'));
// Routing
app.get('/', function(request, response) {
  response.sendFile(path.join(__dirname, 'index.html'));
});
// Starts the server.
server.listen(port, function() {
  console.log('Starting server on port ' + port);
});


const constants = Object.freeze({ 
  cellsAlongAxis: 10, //[1, 1, 0, 0]
  shipsAmount: Object.freeze([4, 3, 2, 1]),
  neibhs: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
});

/*enum (legend)*/
const states = Object.freeze({ length: 9, 
  empty: 0, ship1x: 1, ship2x: 2, ship3x: 3, ship4x: 4, 
  miss: 5, wounded: 6, destroyed: 7, subsidiaryDistance: 8});

class Cell {
  constructor() {
    this.typeField = states.empty;
  }
  set type(val) {
    if (val < 0 || val >= states.length)
      throw new Error('Wrong type of cell');
    this.typeField = val;
  }
  get type() {
    return this.typeField;
  }
}

/*object with different supporting functions*/
const footer = Object.freeze({
  randomArr() {
    function randomStrip() {
      const n = constants.cellsAlongAxis;
      const arr = Array.apply(null, Array(n)).map((key, ind) => ind);
      /*Fisher algo*/
      for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  
    const randomPairs = Array.apply(null, Array(2)).map(() => randomStrip());

    return randomPairs[0].map((keyX) => randomPairs[1].map(keyY => [keyX, keyY]))
                    .reduce((curr, next) => curr.concat(next), []);
  },

  getShipCoords(field, x, y, decks, turn) {
   /*turn: horizontal/verical*/
   const ship = [];

   if (turn) {
      for (let i = 0; i < decks; ++i) {

        if (field[y][x + i])
          ship.push({ x: x + i, y, type: field[y][x + i].type });
      }
   } else {
      for (let i = 0; i < decks; ++i) {
        if (field[y + i])
          ship.push({ x, y: y + i, type: field[y + i][x].type });
      }
    }

    return ship;
  },

  findEmptyPlace(field, randArr, decks, turn) {
    for (let [x, y] of randArr) {
      let ship = footer.getShipCoords(field, x, y, decks, turn);

      if (ship.length === decks && ship.every(x => x.type === states.empty)) {
        return [x, y];
      }

    }

    throw new Error("No empty place");
  },

  gougeNeibhs(field, x, y) {
    constants.neibhs.forEach(([offsetX, offsetY]) => { 
      let ceil = field[y + offsetY] && field[y + offsetY][x + offsetX];

      if (ceil && ceil.type === states.empty) {
        ceil.type = states.subsidiaryDistance;
      }
    });
  },

  ungougeAll(field) {
    field.forEach( row => row.forEach(ceil => {
      if (ceil.type === states.subsidiaryDistance) {
        ceil.type = states.empty;
      }
      }));
  }, 

  markDestroyedShip(field, sheep) {
    const missedArray = [];

    sheep.forEach(({x, y}) => {
      constants.neibhs.forEach(([offsetX, offsetY]) => { 
        let ceil = field[y + offsetY] && field[y + offsetY][x + offsetX];

        if (ceil && ceil.type === states.empty) {
          ceil.type = states.miss;
          missedArray.push({x: x + offsetX, y: y + offsetY, type: ceil.type});
        }
      });
    });
    sheep.forEach(({x, y}) => {
      let ceil = field[y][x];

      ceil.type = states.destroyed;
      missedArray.push({x, y, type: ceil.type});
    });

    return missedArray;
  },

  createField() {
    const n = constants.cellsAlongAxis;
    const field = Array.apply(null, Array(n)).map(() => Array(n));

    field.forEach((val, key) => 
      { field[key] = Array.apply(null, Array(n)).map(() => new Cell); });
    
    return field;
  },

  compareTurns(a, b) {
    return a.x === b.x && a.y === b.y;
  },

  badType(type) {
    switch(type) {
      case states.miss:
      case states.wounded:
      case states.destroyed:
      case states.subsidiaryDistance:
        return true;
    }
    return false;
  }
});


class Ticket {
  constructor(serverID, clientID) {
    this.serverID = serverID;
    this.clientID = clientID;
  }

  get ID() {
    return this.serverID;
  }
}

class TicketsMachine {
  constructor() {
    this.tickets = [];
  }

  getTicket(socketID) {
    if (this.tickets.length >= 2) {
      return null;
    }
    const ticket = new Ticket(this.tickets.length, socketID);
    
    if (this.tickets.length === 0) {
      this.whoTurnsPlayer = ticket;
    }

    this.tickets.push(ticket);

    return ticket;
  }

  next(isHitting) {
    if (!isHitting){
      this.whoTurnsPlayer = 
        this.tickets[ 1 - this.tickets.indexOf(this.whoTurnsPlayer)];
    }
    return this.whoTurnsPlayer;
  }

  current() {
    return this.whoTurnsPlayer;
  }
}

class GameProcess {
  constructor() {
    /*create fields*/
    this.players = [{}, {}];
    
    this.players.forEach(player => { 
      player.field = footer.createField(); 
      player.fieldEnemy = footer.createField(); 
      player.fleet = {
        fleetList: [], 
        links: {}, 
        number: constants.shipsAmount.reduce((curr, next) => curr + next)
      }; 
    }); 
    this.players.forEach(player => this.generateShips(player));
    this.ticketsMachine = new TicketsMachine();
    /*fleet - all ships in army*/
  }

  generateShips(player) {
    const field = player.field;
    const fleet = player.fleet;
    const fleetList = fleet.fleetList;
    const shipsAmount = constants.shipsAmount;
    const shepsTypesNumber = shipsAmount.length;
     
    for (let shipType =  shepsTypesNumber - 1; shipType >= 0; shipType--) {
      let decks = shipType + 1;
      for (let count = shipsAmount[shipType]; count > 0; count--) {
        const randArr = footer.randomArr();
        
        /*horizontal/verical*/
        let turn = +(Math.random() > 0.5);
        let [x, y] = footer.findEmptyPlace(field, randArr, decks, turn);
        let shipCoords = footer.getShipCoords(field, x, y, decks, turn);
        
        shipCoords.forEach(
          ceil => field[ceil.y][ceil.x].type = states[`ship${decks}x`]);
        fleetList.push(shipCoords);
        shipCoords.forEach( ({x, y}) => 
          fleet.links[y + ',' + x] = fleetList[fleetList.length - 1]);
        shipCoords.forEach(val => footer.gougeNeibhs(field, val.x, val.y));
      }
    }
    footer.ungougeAll(field);
  }

};

/*printing*/
// game.players.forEach(player => {
//   let field = JSON.parse(JSON.stringify(player.field));

//   field = field.map(arr => arr.map(x => x.type));
//   console.table(field);
// });
/*end of printing*/

class ServerProcess {
  constructor(io) {
    this.players = {};
    this.game = new GameProcess();
    this.io = io;

    this.io.on('connection', this.connectionGetCallback());   
  }

  connectionGetCallback() {
    return socket => {
      const players = this.players;
      const game = this.game;
      const ticketsMachine = game.ticketsMachine;
      const ticket = ticketsMachine.getTicket(socket.id);

      if (ticket === null) {
        this.serverIsFull(socket);
        return;
      }

      console.log(`player #${socket.id} connected to game`);  
      players[ticket.ID] = game.players[ticket.ID]; 

      setTimeout( () => {
        socket.emit('initialization', 
          [players[ticket.ID], constants, states, ticketsMachine.current().clientID]);
        }, 25);
      
      socket.on('updateServer', this.updateServerCallback(players, 
                                ticketsMachine, ticket));
      socket.on('disconnect', this.disconnectCallback({
        status: 'interrupted',
        whoDisconnected: socket.id
      }));
    }
  }

  updateServerCallback(players, ticketsMachine, ticket) {
    return turn => {
        const player = players[ticket.ID];
        const enemy = players[1 - ticket.ID];
        const {x, y} = turn;
        let isHitting = false;

        //Ожидание другого игрока
        if (!enemy || !enemy.field || !enemy.field[y] || !enemy.field[y][x]) {
          return;
        }

        const cell = enemy.field[y][x];
        const type = cell.type;

        if (ticketsMachine.current().ID !== ticket.ID || footer.badType(type)) {
          console.log('click ignored', ticketsMachine.current().ID, ticket.ID);
          return;
        }
    /*  empty: 0, ship1x: 1, ship2x: 2, ship3x: 3, ship4x: 4, 
    miss: 5, wounded: 6, destroyed: 7, subsidiaryDistance: 8});*/
        switch(type) {
          case states.empty:
            cell.type = states.miss;
            break;
          case states.ship1x:
          case states.ship2x:
          case states.ship3x:
          case states.ship4x:
            cell.type = states.wounded;
            enemy.fleet.links[y + ',' + x].filter(
              (ceilShip) => ceilShip.x === x && ceilShip.y === y)[0].type = states.wounded;
            isHitting = true;
            break;

        }

        const next = ticketsMachine.next(isHitting);

        this.io.sockets.emit('updateClient', {
          whoTurns: ticket.clientID, 
          whoNext: next.clientID, 
          x, y, type: cell.type});

        if (isHitting) {
          const ship = enemy.fleet.links[y + ',' + x];

          if (ship.every(({type}) => type === states.wounded)) {
            const arr = footer.markDestroyedShip(enemy.field, ship);

            arr.forEach(({x, y, type}) => {
              this.io.sockets.emit('updateClient', {
                whoTurns: ticket.clientID, 
                whoNext: next.clientID, 
                x, y, type});
            });

            enemy.fleet.number--;
          }

          if (!enemy.fleet.number) {
            this.disconnectCallback({status: 'end', winner: ticket.clientID})();
          }
        }
      //
    }
  }

  disconnectCallback(reason) {
    return () => {
      if (Object.keys(this.players).length !== 2) {
        return;
      }
      switch(reason.status) {
        case 'end':
          console.log(`player #${reason.winner} wins`);
          //прервать игру для всех
          this.game = new GameProcess();
          this.players = {};
          this.io.sockets.emit('gameStopped', reason);
          break;
        case 'interrupted':
          console.log(`player #${reason.whoDisconnected} disconnected`);
          //прервать игру для всех
          this.game = new GameProcess();
          this.players = {};
          this.io.sockets.emit('gameStopped', {status: "interrupted"});
          break;
      }
    }
  }

  serverIsFull(socket) {
    setTimeout( () => {
      socket.emit('consoleMessage', {error: 'Game canceled. Server is full.'}, 25);
    });
  }
};


const serverProcess = new ServerProcess(io);
