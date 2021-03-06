let method = App.prototype;

const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const querystring = require('querystring');
const request = require('request');
const _ = require('lodash');
const cookieParser = require('cookie-parser');

//Import of used files
const Room = require('./Room').Room;
const User = require('./User').User;
const lib = require('../lib.js');

//Security
const csp = require('helmet-csp');
const cors = require('cors');
const helmet = require('helmet');

/**
* Constructor for a new / room
*
* @author: Michiocre
* @constructor
* @param {string} token The access token needed to connect to the spotify API
* @param {string} rooms The list of all rooms, to make sure no duplicate id
* @return {Room} The new room
*/
function App(production, env, secTillDelete, spotifyAccountAddress, spotifyApiAddress, updateSpeed) {
    //Setup of the server
    this.app = express();
    this.app.use(cookieParser());
    this.server = http.createServer(this.app);
    if (production) {
        this.io = socketIo(this.server);
    }

    this.backendPort = env.backendPort;
    this.frontendPort = env.frontendPort;
    this.ipAddress = env.ipAddress;

    this.spotifyClientId = env.spotifyClientId;
    this.spotifyClientSecret = env.spotifyClientSecret;

    this.spotifyAccountAddress = spotifyAccountAddress;
    this.spotifyApiAddress = spotifyApiAddress;

    this.secTillDelete = secTillDelete;
    this.updateSpeed = updateSpeed;

    //Time unit is amount of updates;
    this.playlistRefreshTimer = 300;
    this.tokenRefreshTimer = 3500;

    this.uriBack = '';

    if (this.ipAddress === 'localhost') {
        this.uriBack = 'http://' + this.ipAddress + ':' + this.backendPort;
    } else {
        this.uriBack = 'https://' + this.ipAddress + ':' + this.frontendPort;
    }
    this.redirect_uri = this.uriBack + '/callback';

    this.referer = '';
    this.rooms = [];
    this.users = [];

    // eslint-disable-next-line no-console
    console.log('INFO: Redirect URL: ' + this.redirect_uri);

    this.setHeaders();

    this.httpCalls();
    
    /**
    * Is called when a new connection is established
    */
    if (production) {
        this.io.sockets.on('connection', socket => this.socketCall(socket));       
    }
}

method.setHeaders = function() {
    this.app.disable('x-powered-by');
    this.app.use(function (req, res, next) {
        res.set('Server', 'Yes');
        next();
    });
    this.app.use(
        csp({
            directives: {
                defaultSrc: ['"self"']
            }
        }),
        helmet.featurePolicy({
            features: {
                fullscreen: ['"self"'],
                vibrate: ['"none"'],
                payment: ['"none"'],
                syncXhr: ['"none"']
            }
        }),
        helmet.referrerPolicy({ policy: 'same-origin' }),
        helmet.frameguard({
            action: 'deny'
        }),
        helmet.hsts({
            maxAge: 15768000 //Six Months in Seconds
        }),
        helmet.xssFilter(),
        helmet.noSniff(),
        cors({
            origin: '*',
            methods: 'GET',
            preflightContinue: false,
            optionsSuccessStatus: 204
        })
    );
};

method.httpCalls = function() {
    this.app.get('/', (req, res) => {
        res.send('Hello There');
    });

    /**
    * Login using the Spotify API (This is only a Redirect)
    */
    this.app.get('/login', (req, res) => {
        try {
            this.referer = req.headers.referer.substring(0, req.headers.referer.lastIndexOf('/'));
            // eslint-disable-next-line no-console
            console.log('INFO: User was sent to Spotify login');
            let redirect_uri = this.redirect_uri;
            res.redirect(this.spotifyAccountAddress + '/authorize?' + querystring.stringify({response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID, scope: 'user-read-private user-read-email user-read-currently-playing user-modify-playback-state user-read-playback-state user-top-read playlist-read-collaborative playlist-read-private', redirect_uri}));
        } catch (error) {
            res.status(400).send('Login from the main page.');
        }

    });

    /**
    * The callback that will be called when the Login with the Spotify API is completed
    * Will get User-Date from the api and redirect to the Dashboard
    */
    this.app.get('/callback', async (req, res) => {
        let code = req.query.code || null;
        let authOptions = {
            url: this.spotifyAccountAddress +'/api/token',
            form: {
                code: code,
                redirect_uri: this.redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(this.spotifyClientId + ':' + this.spotifyClientSecret).toString('base64'))
            },
            json: true
        };
        request.post(authOptions, async (error, response, body) => {
            if (response.statusCode === 200) {
                let uri = this.referer + '/dashboard';
                let user = new User(this.spotifyAccountAddress, this.spotifyApiAddress, body.access_token, body.refresh_token, this.spotifyClientId, this.spotifyClientSecret);
                // Set cookie
                // res.cookie('token', body.access_token, options); // options is optional
                if (await user.fetchData() === true) {
                    this.users.push(user);
                    // eslint-disable-next-line no-console
                    console.log('INFO-[USER: '+user.name+']: This user has logged in');
                    res.redirect(uri + '?token=' + body.access_token);
                } else {
                    res.status(400).send();
                }
            } else {
                res.status(400).send();
            }
            
        });
    });

    /**
    * The callback that will be called when the Login with the Spotify API is completed
    * Will redirect the user to the newly created room
    */
    this.app.get('/createRoom', async (req, res) => {
        let user = lib.getUserById(req.query.id, this.users);
        if (user === null) {
            res.status(400).end();
        } else {
            let room = new Room(this.spotifyAccountAddress, this.spotifyApiAddress, user, this.rooms);
            let uri = this.referer + '/app';
            this.rooms.push(room);
        
            res.redirect(uri + '/' + room.id);
        }
    });

    /**
    * Get a list of all rooms
    *
    * @Returns ResponseCode of 200
    * @Returns content Array of all the rooms
    */
    this.app.get('/rooms', async (req, res) => {
        // eslint-disable-next-line no-console
        console.log('INFO: /rooms has been called.');
        res.setHeader('Access-Control-Allow-Origin', '*');

        try {
            let returnRooms = [];
            for (var i = 0; i < this.rooms.length; i++) {
                let roomI = {
                    roomName: this.rooms[i].id,
                    roomHost: this.rooms[i].user.name,
                    roomCover: 'https://via.placeholder.com/152x152'
                };
                if (this.rooms[i].activePlaylist !== null) {
                    roomI.roomCover = this.rooms[i].activePlaylist.images[0].url;
                }
                returnRooms.push(roomI);
            }

            res.status(200).send(returnRooms);
        } catch (error) {
            res.status(400).send('Error while getting Room List');
        }
    });
};

method.socketCall = function(socket) {
    //Local varibles, can only be used by the same connection (but in every call)

    socket.isHost = false;
    socket.name = null;
    socket.updateCounter = {
        amount: 0
    };
    socket.oldUpdate = null;

    //This function is called every 500ms
    let updateInterval = setInterval(() => this.theUpdateFunction(socket), this.updateSpeed);

    //This is what happens when a user connects
    socket.emit('roomId');

    /**
	* Called when a user wants to connect to a room
	*
	* Will set the local varible {room} and {isHost}
	* @param {string} roomId Id of the room
	*/
    socket.on('roomId', data => {
        let room = lib.getRoomById(data.roomId, this.rooms);

        if (room !== null) {
            socket.roomId = room.id;

            //Delete if old
            let toBeDeleted = [];
            for (let i = 0; i < this.rooms.length; i++) {
                if (this.rooms[i].hostPhone === false) {
                    if (Date.now() - this.rooms[i].hostDisconnect > 1000 * this.secTillDelete && this.rooms[i].hostDisconnect !== null) {
                        toBeDeleted.push(this.rooms[i]);
                    }
                }
            }
            for (let i = 0; i < toBeDeleted.length; i++) {
                // eslint-disable-next-line no-console
                console.log('INFO-[ROOM: ' + toBeDeleted[i].id + ']: This room has been deleted due to inactivity.');
                this.rooms.splice(this.rooms.indexOf(toBeDeleted[i]), 1);
            }

            //Count how many rooms this user is already hosting
            let x = -1;
            for (let i = 0; i < this.rooms.length; i++) {
                if (this.rooms[i].user !== null) {
                    if (this.rooms[i].user.id === room.user.id && this.rooms[i].id !== room.id) {
                        x = i;
                        break;
                    }
                }
            }

            if (x >= 0 && room.firstConnection === true) {
                room.firstConnection = false;
                socket.emit('twoRooms', {oldRoom: this.rooms[x].id});
            } else if (x >= 0) {
                socket.emit('errorEvent', {message: 'Room is still generating.'});
            } else {
                socket.name = room.user.name;

                if (room.firstConnection === true) {
                    room.firstConnection = false;
                    // eslint-disable-next-line no-console
                    console.log('INFO-[ROOM: ' + socket.roomId + ']: The host [' + socket.name + '] has connected (Sending Token). [Phone: ' + data.isPhone + ']');

                    socket.isHost = true;
                    room.hostPhone = data.isPhone;

                    let update = room.getDifference(null);
                    socket.oldUpdate = _.cloneDeep(room);

                    update.isHost = socket.isHost;

                    update.token = room.user.token;

                    socket.emit('initData', update);
                    room.hostDisconnect = null;
                } else {
                    if (room.hostDisconnect !== null && data.token === room.user.token) { //If host is gone
                        // eslint-disable-next-line no-console
                        console.log('INFO-[ROOM: ' + socket.roomId + ']: The host [' + socket.name + '] has connected. [Phone: ' + data.isPhone + ']');

                        socket.isHost = true;
                        room.hostPhone = data.isPhone;

                        let update = room.getDifference(null);
                        socket.oldUpdate = _.cloneDeep(room);

                        update.isHost = socket.isHost;

                        socket.emit('initData', update);
                        room.hostDisconnect = null;
                    } else {
                        socket.emit('nameEvent', {title: 'What is your name?'});
                    }
                }
            }
        } else {
            socket.emit('errorEvent', {message: 'Room has been closed'});
        }
    });

    /**
	* Called when a user has decided wether to delete the oldRoom or use the new one
	*
	* Will delete the old room, or the new one
	* @param {boolean} value True if the old room will be deleted
	* @param {boolean} roomId Id of the old room
	*/
    socket.on('twoRooms', data => {
        let oldRoom = lib.getRoomById(data.roomId, this.rooms);
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (data.value === true) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + oldRoom.id + ']: This room has been deleted due to host creating a new one.');
            this.rooms.splice(this.rooms.indexOf(oldRoom), 1);

            socket.name = room.user.name;

            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: The host [' + socket.name + '] has connected (Sending Token). [Phone: ' + data.isPhone + ']');

            socket.isHost = true;
            room.hostPhone = data.isPhone;

            let update = room.getDifference(null);
            socket.oldUpdate = _.cloneDeep(room);

            update.isHost = socket.isHost;

            update.token = room.user.token;

            socket.emit('initData', update);
            room.hostDisconnect = null;
        } else {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: This room has been deleted due to more then 1 room (Host choose the old room).');
            this.rooms.splice(this.rooms.indexOf(room), 1);
            socket.emit('errorEvent', {message: 'Room has been closed'});
        }
    });

    /**
	* Called when a user thats not a host wants to enter a room
	*
	* Will set the local varible {name}
	* @param {string} name Name of the user
	*/
    socket.on('nameEvent', data => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            if (room.getUserNames().includes(data.name) === true) {
                socket.emit('nameEvent', {title: 'This name is already taken, enter a different name.'});
            } else if (data.name.trim() === '') {
                socket.emit('nameEvent', {title: 'This name can´t be emtpy, enter a different name.'});
            } else if (data.name.length > 15) {
                socket.emit('nameEvent', {title: 'This name is too long, enter a different name.'});
            } else {
                // eslint-disable-next-line no-console
                console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + data.name + '] has connected.');
                socket.name = data.name;
                room.addUser(socket.name);

                let update = room.getDifference(null);
                socket.oldUpdate = _.cloneDeep(room);

                socket.emit('initData', update);
            }
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when the host changes the volume
	* @param {int} volume Volume in percent
	*/
    socket.on('changeVolume', data => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: Volume changed to [' + data.volume + '].');
            room.changeVolume(data.volume);
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when the host changes the playlist
	* @param {string} playlistId Id of the Playlist
	*/
    socket.on('changePlaylist', data => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            room.changePlaylist(data.playlistId);
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when a user votes on a track
	* @param {string} trackId Id of the track
	*/
    socket.on('vote', data => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + socket.name + '] voted for [' + data.trackId + '].');
            room.vote(data.trackId, socket.isHost, socket.name);

            let update = room.getDifference(socket.oldUpdate);
            socket.oldUpdate = _.cloneDeep(room);
            socket.emit('update', update);
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when the host decides to skip the currently playing song
	*/
    socket.on('skip', data => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + socket.name + '] skiped the song.');
            room.play();

            let update = room.getDifference(socket.oldUpdate);
            socket.oldUpdate = _.cloneDeep(room);
            socket.emit('update', update);
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when the host wants to close the room
	*/
    socket.on('logout', (data) => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            if (data.token === room.token) {
                this.rooms.splice(this.rooms.indexOf(room), 1);
                // eslint-disable-next-line no-console
                console.log('INFO-[ROOM: ' + room.id + ']: This room has been deleted by host.');
            }
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when the song should be paused or played
	*/
    socket.on('pause', () => {
        let room = lib.getRoomById(socket.roomId, this.rooms);
        if (room !== null) {
            room.togglePlaystate();

            let update = room.getDifference(socket.oldUpdate);
            socket.oldUpdate = _.cloneDeep(room);
            socket.emit('update', update);
        } else {
            socket.emit('errorEvent', {message: 'Room was closed'});
        }
    });

    /**
	* Called when a connection is closed
	*/
    socket.on('disconnect', () => {
        let room = lib.getRoomById(socket.roomId, this.rooms);

        clearInterval(updateInterval);
        if (room !== null) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + socket.name + '] disconnected.');
            if (socket.isHost === false) {
                room.removeUser(socket.name);
            } else {
                room.hostDisconnect = Date.now();
            }
        } else {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + socket.name + '] auto-disconnected.');
        }
    });
};


/**
* This function will be called every interval and is used to update the users
*
* @author: Michiocre
* @param {socket} socket The socket object passed down from the call
*/
method.theUpdateFunction = async function(socket) {
    let room = lib.getRoomById(socket.roomId, this.rooms);

    socket.updateCounter.amount += 1;

    if (room !== null) {
        await room.update(socket.isHost);

        if (socket.updateCounter.amount % this.playlistRefreshTimer === 0 && socket.isHost === true) {
            room.updatePlaylists();
        }

        if (socket.updateCounter.amount % this.tokenRefreshTimer === 0 && socket.isHost === true) {
            room.refreshToken();
        }

        let update = room.getDifference(socket.oldUpdate);

        if (update !== null) {
            socket.emit('update', update);
        }

        socket.oldUpdate = _.cloneDeep(room);

        if (socket.updateCounter.amount % 30 === 0) {
            let toBeDeleted = [];
            for (let i = 0; i < this.rooms.length; i++) {
                if (this.rooms[i].hostPhone === false) {
                    if (Date.now() - this.rooms[i].hostDisconnect > 1000 * this.secTillDelete && this.rooms[i].hostDisconnect !== null) {
                        toBeDeleted.push(this.rooms[i]);
                    }
                }
            }
            for (let i = 0; i < toBeDeleted.length; i++) {
                // eslint-disable-next-line no-console
                console.log('INFO-[ROOM: ' + toBeDeleted[i].id + ']: This room has been deleted due to inactivity.');
                this.rooms.splice(this.rooms.indexOf(toBeDeleted[i]), 1);
            }
        }

        if (socket.updateCounter.amount > 30000) {
            socket.updateCounter.amount = 0;
        }
    } else {
        //socket.emit('errorEvent', {message: 'Room does not exist'});
    }
};


method.addRoom = function(user) {
    let room = new Room(this.spotifyAccountAddress, this.spotifyApiAddress, user, this.rooms);
    this.rooms.push(room);
    return room;
};

method.addUser = function(access_token, refresh_token, name, id) {
    let user = new User(this.spotifyAccountAddress, this.spotifyApiAddress, access_token, refresh_token, this.spotifyClientId, this.spotifyClientSecret);
    
    user.playlists = [];
    user.name = name;
    user.id = id;
    
    this.users.push(user);
    return user;
};

module.exports = {App: App};