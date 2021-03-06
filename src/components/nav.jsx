import {useEffect} from 'react';
import {Link} from 'react-router-dom';


function Nav()
{
	function toggle(e) {
    document.querySelector('#navbar').classList.toggle('navbar-mobile')
    e.target.classList.toggle('bi-list')
    e.target.classList.toggle('bi-x')
  }

  useEffect(()=>{
  	document.querySelector('.mobile-nav-toggle')
  	.addEventListener('click',toggle);
  });

	return(
		<header id="header" className="fixed-top">
	    <div className="container d-flex align-items-center justify-content-between">

	      <h1 className="logo"><Link to="/">tinyPay</Link></h1>
	     

	      <nav id="navbar" className="navbar">
	        <ul>
	          <li><Link className="nav-link active" to="/about">About</Link></li>
	          {/*<li><Link to="/payment">Pay Money</Link></li>*/}
	          {/*<li><Link to="/verify">Verify Payment</Link></li>
	          <li><Link to="/reciept">Request Receipt</Link></li>
	          <li><Link to="issues">Complain</Link></li>*/}
	        </ul>
	        <i className="bi bi-list mobile-nav-toggle" onClick={toggle}></i>
	      </nav>

	    </div>
    </header>
   );
}


export default Nav;