import React, {PureComponent} from 'react';
import {css} from 'glamor';

import SongIcon from './Footer/SongIcon.jsx';
import SongAggregation from './Footer/SongAggregation.jsx';
import VolumeBar from './Footer/VolumeBar.jsx';
import ProgressBar from './Footer/ProgressBar.jsx';
import PlayButtons from './Footer/PlayButtons.jsx';

let constants = require('../../js/constants');
const styles = {
    wrapper: css({
        height: '75px',
        width: '100vw',
        position: 'absolute',
        bottom: 0,
        backgroundColor: constants.colors.backgroundLite,
        textOverflow: 'ellipsis',
        display: 'flex'
    })
};

class Footer extends PureComponent {

    render() {
        let track = {
            img: '',
            name: '',
            artists: []
        };
        if (this.props.activePlayer !== null && this.props.activePlayer !== undefined) {

            if (this.props.activePlayer.track !== null && this.props.activePlayer.track !== undefined) {
                track = {
                    img: this.props.activePlayer.track.album.images[this.props.activePlayer.track.album.images.length - 1].url,
                    name: this.props.activePlayer.track.name,
                    artists: this.props.activePlayer.track.artists
                };
            }
        }

        return (<footer className={`${styles.wrapper}`}>
            <SongIcon background={track.img}/>
            <SongAggregation songName={track.name} artists={track.artists}/>
            <ProgressBar activePlayer={this.props.activePlayer}/> {
                this.props.isHost
                    ? <VolumeBar activePlayer={this.props.activePlayer} socket={this.props.socket}/>
                    : ''
            }
            <PlayButtons playHandler={this.props.playHandler} skipHandler={this.props.skipHandler} activePlayer={this.props.activePlayer} isHost={this.props.isHost} socket={this.props.socket}/>
        </footer>);
    }
}

export default Footer;
