import {Link} from 'react-router-dom';


function Footer ()
{
	return(
		<>

		<footer id="footer">

		    <div className="footer-top">
		      <div className="container">
		        <div className="row">

		          <div className="col-lg-3 col-md-6 footer-contact">
		            <h3>tinyPay</h3>
		            <p>
		              A108 Adam Street <br />
		              New York, NY 535022<br />
		              United States <br /><br />
		              <strong>Phone:</strong> +1 5589 55488 55<br />
		              <strong>Email:</strong> info@example.com<br />
		            </p>
		          </div>


		        </div>
		      </div>
		    </div>

		    <div className="container d-md-flex py-4">

		      <div className="me-md-auto text-center text-md-start">
		        <div className="copyright">
		          &copy; Copyright <strong><span>tinyPay & Nacos Plasu</span></strong>. All Rights Reserved
		        </div>
		      </div>
		      {/*<div className="social-links text-center text-md-right pt-3 pt-md-0">
		        <a href="#" className="twitter"><i className="bx bxl-twitter"></i></a>
		        <a href="#" className="facebook"><i className="bx bxl-facebook"></i></a>
		        <a href="#" className="instagram"><i className="bx bxl-instagram"></i></a>
		        <a href="#" className="google-plus"><i className="bx bxl-skype"></i></a>
		        <a href="#" className="linkedin"><i className="bx bxl-linkedin"></i></a>
		      </div>*/}
		    </div>
		  </footer>
			
		</>
	);
}

export default Footer