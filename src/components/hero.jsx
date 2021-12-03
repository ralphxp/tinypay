import {Link} from 'react-router-dom';

function Hero()
{
	return (
		<section id="hero" className="d-flex align-items-center">

		    <div className="container d-flex flex-column align-items-center justify-content-center" data-aos="fade-up">
		      <h1>Make Fast and Secure Payments</h1>
		      <h2>tinyPay is a secure payment platform for schools and SMEs</h2>
		      <Link to="/payment" className="btn-get-started scrollto">Make Payment</Link>
		      <img src="/img/tinypay.jpeg." className="img-fluid hero-img" alt="" data-aos="zoom-in" data-aos-delay="150" />
		    </div>

		</section>
	);
}

export default Hero