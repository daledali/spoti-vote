const http = require('http');
const express = require('express');
const querystring = require('querystring');
const request = require('request');
const _ = require('lodash');
const bodyParser = require('body-parser');
//Security
const csp = require('helmet-csp');
const cors = require('cors');
const helmet = require('helmet');
//Import of used files
const Room = require('./Classes/Room');
const Host = require('./Classes/Host');
const env = require('./env').getEnv();

let expressApp = express();
//expressApp.use(cookieParser());
expressApp.use(bodyParser.json());
let server = http.createServer(expressApp);

let config = {
    uriBack: '',
    redirect_uri: '',
    referer: ''
};

if (env.frontendPort === 443) {
    config.uriBack = 'https://' + env.ipAddress + ':' + env.frontendPort;
} else {
    config.uriBack = 'http://' + env.ipAddress + ':' + env.backendPort;
}

config.redirect_uri = config.uriBack + '/callback';

let data = {
    rooms: [],
    hosts: []
};

// eslint-disable-next-line no-console
console.log('INFO: Redirect URL: ' + config.redirect_uri);

setHeaders();
setHttpCalls();

function setHeaders() {
    expressApp.disable('x-powered-by');
    expressApp.use(function (req, res, next) {
        res.set('Server', 'Yes');
        next();
    });

    expressApp.use(
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
            methods: 'GET, POST',
            preflightContinue: false,
            optionsSuccessStatus: 204
        })
    );
}

function setHttpCalls() {
    expressApp.get('/', (req, res) => {
        res.send('Hello There');
    });

    /**
    * Login using the Spotify API (This is only a Redirect)
    */
    expressApp.get('/login', (req, res) => {
        try {
            config.referer = req.headers.referer.substring(0, req.headers.referer.lastIndexOf('/'));
            // eslint-disable-next-line no-console
            console.log('INFO: Host was sent to Spotify login');
            let redirect_uri = config.redirect_uri;
            res.redirect(env.spotifyAccountAddress + '/authorize?' + querystring.stringify({response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID, scope: 'user-read-private user-read-email user-read-currently-playing user-modify-playback-state user-read-playback-state user-top-read playlist-read-collaborative playlist-read-private', redirect_uri}));
        } catch (error) {
            res.status(400).send('Login from the main page.');
        }
    });

    /**
    * The callback that will be called when the Login with the Spotify API is completed
    * Will get Host-Date from the api and redirect to the Dashboard
    */
    expressApp.get('/callback', async (req, res) => {
        let code = req.query.code || null;
        let authOptions = {
            url: env.spotifyAccountAddress +'/api/token',
            form: {
                code: code,
                redirect_uri: config.redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(env.spotifyClientId + ':' + env.spotifyClientSecret).toString('base64'))
            },
            json: true
        };
        request.post(authOptions, async (error, response, body) => {
            if (response.statusCode === 200) {
                let uri = config.referer + '/dashboard';
                let host = new Host.Host(body.access_token, body.refresh_token);
                if (await host.fetchData() === true) {
                    data.hosts.push(host);
                    // eslint-disable-next-line no-console
                    console.log('INFO-[HOST: '+host.name+']: This host has logged in');
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
    * 
    */
    expressApp.post('/profile', async (req, res) => {
        let response;
        // eslint-disable-next-line no-console
        console.log('INFO: /profile has been called.');
        res.setHeader('Access-Control-Allow-Origin', '*');

        let host = Host.getHostByToken(req.body.token, data.hosts);
        if (host !== null) {
            response = {error: false, host: host.getData()};
            res.status(200);
        } else {
            response = {error: true, message: 'Login expired.'};
            res.status(400);
        }

        res.send(JSON.stringify(response));
    });

    /**
    * Get a list of all rooms
    *
    * @Returns ResponseCode of 200
    * @Returns content Array of all the rooms
    */
    expressApp.get('/rooms', async (req, res) => {
        // eslint-disable-next-line no-console
        console.log('INFO: /rooms has been called.');
        res.setHeader('Access-Control-Allow-Origin', '*');

        let returnRooms = [];
        for (var i = 0; i < data.rooms.length; i++) {
            let roomData = data.rooms[i].getData(false);
            let roomI = {
                roomName: roomData.roomId,
                roomHost: roomData.host.name
            };
            try {
                roomI.roomCover = roomData.activePlayer.track.album.images[0].url;
            } catch (error) {
                try {
                    roomI.roomCover = roomData.activePlaylist;
                } catch (error) {
                    break;
                }
            }
            if (roomI.roomCover === null || roomI.roomCover === undefined) {
                roomI.roomCover = roomData.host.img;
            }
            returnRooms.push(roomI);
        }

        res.status(200).send(returnRooms);
    });

    /**
    * The callback that will be called when the Login with the Spotify API is completed
    * Will redirect the host to the newly created room
    */
    expressApp.post('/rooms/checkCreate', async (req, res) => {
        let host = Host.getHostById(req.body.id, data.hosts);
        let response;
        if (host === null) {
            response = {error: true, message: 'Login expired.'};
            res.status(400);
        } else {
            let room = Room.getRoomByHost(host, data.rooms);
            if (room !== null) {
                response = {error: false, roomId: room.id};
            } else {
                response = {error: false};
            }
            res.status(200);
        }
        res.send(JSON.stringify(response));
    });

    /**
    * The callback that will be called when the Login with the Spotify API is completed
    * Will redirect the host to the newly created room
    */
    expressApp.post('/rooms/create', async (req, res) => {
        let host = Host.getHostById(req.body.id, data.hosts);
        let response;
        if (host === null) {
            response = {error: true, message: 'Login expired.'};
            res.status(400);
        } else {
            let room = new Room.Room(host, data.rooms);
            data.rooms.push(room);
            res.status(200);
            
            response = {error: false, roomId: room.id};
        }
        res.send(JSON.stringify(response));
    });

    /**
    * Returns the data of a given Room and updates the room state
    *
    * @Returns ResponseCode of 200
    * @Returns content of the room
    */
    expressApp.post('/rooms/:roomId/update', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let response;

        let room = Room.getRoomById(req.params.roomId, data.rooms);
        if (room === null) {
            response = {error: true, message: 'Room not found'};
            res.status(400);
        } else {
            if (_.keys(req.body).length > 1) {
                if (req.body.playlistId !== null && req.body.playlistId !== undefined) {
                    room.changePlaylist(req.body.playlistId);
                }
            } else {
                await room.update();
                response = {error: false, room: room.getData(req.body.token)};
                res.status(200);
            }
        }
        console.log('Update size: ' + JSON.stringify(response).length);
        res.send(JSON.stringify(response));
    });

    /**
    * Changes the rooms current Playlist and generates new Vote-Tracks
    *
    * @Returns ResponseCode of 200
    */
    expressApp.post('/rooms/:roomId/selectPlaylist', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let response;

        let room = Room.getRoomById(req.params.roomId, data.rooms);
        if (req.body.id === room.host.id) {
            if (req.body.playlistId !== null && req.body.playlistId !== undefined) {
                room.changePlaylist(req.body.playlistId);
                response = {error: false};
                res.status(200);
            }
        }

        res.send(JSON.stringify(response));
    });

    /**
    * Returns the data of a given Room
    *
    * @Returns ResponseCode of 200
    * @Returns content of the room
    */
    expressApp.post('/rooms/:roomId/delete', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let room = Room.getRoomById(req.params.roomId, data.rooms);

        if (req.body.id === room.host.id) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: This room has been deleted due to more then 1 room (Host choose the old room).');
            data.rooms.splice(data.rooms.indexOf(room), 1);
        }
    });

    /**
    * Change the volume of the room
    * @Param req.params.roomId
    * @Param req.body.id
    * @Param req.body.volume
    */
    expressApp.post('/rooms/:roomId/volume', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let room = Room.getRoomById(req.params.roomId, data.rooms);

        if (req.body.id === room.host.id) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + req.params.roomId + ']: Volume changed to [' + req.body.volume + '].');
            room.changeVolume(req.body.volume);
        }
        res.send();
    });

    /**
    * Adds a vote from user
    * @Param req.params.roomId
    * @Param req.body.id
    * @Param req.body.username
    * @Param req.body.trackId
    */
    expressApp.post('/rooms/:roomId/vote', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let room = Room.getRoomById(req.params.roomId, data.rooms);

        if (req.body.id === room.host.id) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: [' + req.body.id + '] voted for [' + req.body.trackId + '].');
            room.vote(req.body.trackId, req.body.id);
        } else {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: [' + req.body.username + '] voted for [' + req.body.trackId + '].');
            room.vote(req.body.trackId, req.body.username);
        }
        res.send();
    });

    /**
    * Skips current song
    * @Param req.params.roomId
    * @Param req.body.id
    */
    expressApp.post('/rooms/:roomId/skip', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let room = Room.getRoomById(req.params.roomId, data.rooms);

        if (req.body.id === room.host.id) {
            // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: Host skiped the song.');
            room.play();
        }
        res.send();
    });

    /**
    * Pause/Resume current song
    * @Param req.params.roomId
    * @Param req.body.id
    */
    expressApp.post('/rooms/:roomId/pause', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');

        let room = Room.getRoomById(req.params.roomId, data.rooms);

        if (req.body.id === room.host.id) {
        // eslint-disable-next-line no-console
            console.log('INFO-[ROOM: ' + room.id + ']: Host skiped the song.');
            room.togglePlaystate();
        }
        res.send();
    });
}

//     /**
// 	* Called when a user thats not a host wants to enter a room
// 	*
// 	* Will set the local varible {name}
// 	* @param {string} name Name of the user
// 	*/
//     socket.on('nameEvent', data => {
//         let room = lib.getRoomById(socket.roomId, this.rooms);
//         if (room !== null) {
//             if (room.getUserNames().includes(data.name) === true) {
//                 socket.emit('nameEvent', {title: 'This name is already taken, enter a different name.'});
//             } else if (data.name.trim() === '') {
//                 socket.emit('nameEvent', {title: 'This name can´t be emtpy, enter a different name.'});
//             } else if (data.name.length > 15) {
//                 socket.emit('nameEvent', {title: 'This name is too long, enter a different name.'});
//             } else {
//                 // eslint-disable-next-line no-console
//                 console.log('INFO-[ROOM: ' + socket.roomId + ']: [' + data.name + '] has connected.');
//                 socket.name = data.name;
//                 room.addUser(socket.name);

//                 let update = room.getDifference(null);
//                 socket.oldUpdate = _.cloneDeep(room);

//                 socket.emit('initData', update);
//             }
//         } else {
//             socket.emit('errorEvent', {message: 'Room was closed'});
//         }

//     });


/**
* Starts the server
*/
server.listen(env.backendPort, () => {
    // eslint-disable-next-line no-console
    console.log('INFO: Server started on port: ' + server.address().port);
});