import {Link} from 'react-router-dom';
// import $ from 'jquery';


function Nav()
{
	function toggle(e) {
    document.querySelector('#navbar').classList.toggle('navbar-mobile')
    e.target.classList.toggle('bi-list')
    e.target.classList.toggle('bi-x')
  }

	return(
		<header id="header" className="fixed-top">
		    <div className="container d-flex align-items-center justify-content-between">

		      <h1 className="logo"><Link to="/">tinyPay</Link></h1>
		     

		      <nav id="navbar" className="navbar">
		        <ul>
		          <li><Link className="nav-link scrollto active" to="/">Home</Link></li>
		          {/*<li><Link className="nav-link scrollto" to="#about">About</Link></li>*/}
		          <li><Link to="#">Pay Money</Link></li>
		          <li><Link to="#">Verify Payment</Link></li>
		          <li><Link to="#">Request Receipt</Link></li>
		          <li><Link to="#">Drop a Complain</Link></li>
		        </ul>
		        <i className="bi bi-list mobile-nav-toggle" onClick={toggle}></i>
		      </nav>

		    </div>
  </header>
    );
}


export default Nav;