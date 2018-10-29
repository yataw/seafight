
class ClientGame {
  constructor(socket, player, constants, states) {
    /*В __proto__ для объектов Cell нет get type. Используем typeField*/
    this.player = player;

    this.player.tableDOM = document.getElementById("playerTable");
    this.player.tableDOMEnemy = document.getElementById("enemyTable");
    this.playerTableCaption = document.querySelector("#playerTable caption");

    this.constants = constants;
    this.constants.AsymbCode = 65;
    this.constants = Object.freeze(this.constants);
    this.classNames = {};
    this.isListening = false;

    const keys = Object.values(states), values = Object.keys(states);
    
    keys.forEach((key, ind) => this.classNames[key] = values[ind]);

    this.createTableDOM(this.player.tableDOM, player.field);
    this.createTableDOM(this.player.tableDOMEnemy, player.fieldEnemy);

    this.player.tableDOMEnemy.addEventListener('click', e => {
      if (!this.isListening)
        return;

      const td = e.target.closest('td');
      const tr = td ? td.closest('tr') : null;
      const turn = {};

      if (!td) return;

      turn.y = tr.rowIndex - 1;
      turn.x = td.cellIndex - 1;

      console.log('upd')
      socket.emit('updateServer', turn);
    });
  }

  createTableDOMHeader(tableDOM) {
    while (tableDOM.tHead.firstElementChild) {
      tableDOM.tHead.removeChild(tableDOM.tHead.firstElementChild);
    }

    const headerNodes = document.createElement('tr');
    const n = this.constants.cellsAlongAxis;

    for(let i = 0; i < n + 1; ++i) {
      const th = document.createElement('th');
      
      if (i) {
        th.textContent = i;
      } else {
        th.textContent = "\\";
      }
      headerNodes.appendChild(th);
    }

    tableDOM.tHead.appendChild(headerNodes);
  }

  createTableDOMBody(tableDOM, field) {
    while (tableDOM.tBodies[0].firstElementChild) {
      tableDOM.tBodies[0].removeChild(tableDOM.tBodies[0].firstElementChild);
    }

    const n = this.constants.cellsAlongAxis;

    for(let i = 0; i < n; ++i) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');

      th.textContent = String.fromCharCode(this.constants.AsymbCode + i);
      tr.appendChild(th);

      for (let j = 0; j < n; ++j) {
        const td = document.createElement('td');

        td.classList.add(this.classNames[field[i][j].typeField]); 
        tr.appendChild(td);
      }

      tableDOM.tBodies[0].appendChild(tr);
    }    
  }

  createTableDOM(tableDOM, field) {
    this.createTableDOMHeader(tableDOM);
    this.createTableDOMBody(tableDOM, field);
  }
};

class ClientProcess {
  constructor() {
    this.socket = io();
    const socket = this.socket;

    socket.on('initialization', this.initializationCallBack());
    socket.on('consoleMessage', this.consoleMessageCallback());
    socket.on('gameStopped', this.gameStoppedCallBack());
  }

  consoleMessageCallback() {
    return (message) => {
      if (message.error) {
        throw new Error(message.error);
      }
    }
  }

  initializationCallBack() {
    return ([player, constants, states, whoStartsListening]) => {
      const socket = this.socket;

      this.game = new ClientGame(socket, player, constants, states);
      this.game.isListening = (whoStartsListening === socket.id) ? true : false;

      if (this.game.isListening) {
        this.game.playerTableCaption.classList.add('whoTurns');
      }

      socket.on('updateClient', this.updateClientCallBack());      
    }
  }

  updateClientCallBack() {
    return ({whoTurns, whoNext, x, y, type}) => {
      const game = this.game;
      const socket = this.socket;
      const cell = (whoTurns === socket.id) ? 
        game.player.tableDOMEnemy.rows[y + 1].cells[x + 1] :
        game.player.tableDOM.rows[y + 1].cells[x + 1];
      const isListening = (whoNext === socket.id) ? true : false;

      game.isListening = isListening;

      if (isListening) {
        if (!game.playerTableCaption.classList.contains('whoTurns')) {
          game.playerTableCaption.classList.add('whoTurns');
        }
      } else {
        game.playerTableCaption.classList.remove('whoTurns');
      }
      
      cell.classList.remove(cell.className);
      cell.classList.add(game.classNames[type]);
    }
  }

  gameStoppedCallBack() {
    return (obj) => {
      const status = obj.status;
      const socket = this.socket;

      if (status === 'interrupted') {
        socket.removeListener('updateClient', this.updateClientCallBack()); 
        alert('Game interrupted. Refresh page to start a new game.');
      }

      if (status === 'end') {
        socket.removeListener('updateClient', this.updateClientCallBack()); 
        (obj.winner === socket.id) ? alert('You win!') : alert('You lose');
      }
    }
  }
};

const clientProcess = new ClientProcess();