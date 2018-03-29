import React, {Component} from 'react';
import FontAwesomeIcon from '@fortawesome/react-fontawesome';
import {faHome} from '@fortawesome/fontawesome-free-solid';

let defaultStyle = {
	width: '75px',
	height: '75px',
	boxSizing: 'border-box',
	padding: '10px',
	paddingTop: '25px'
};

class Home extends Component {
	render() {
		return (<a href={"http://localhost:3000/app?access_token=" + this.props.token}>
			<div style={defaultStyle}>
				<FontAwesomeIcon icon={faHome} size="2x" className=""/>
			</div>
		</a>);
	}
}
export default Home;