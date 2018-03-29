import React, {Component} from 'react';
import FontAwesomeIcon from '@fortawesome/react-fontawesome';
import {faUsers} from '@fortawesome/fontawesome-free-solid';

let defaultStyle = {
	width: '75px',
	height: '75px',
	boxSizing: 'border-box',
	padding: '10px'
};

class Rooms extends Component {
	render() {
		return (<div style={defaultStyle}>
			<FontAwesomeIcon icon={faUsers} size="2x"/>
		</div>);
	}
}
export default Rooms;
