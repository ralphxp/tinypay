import {Link} from 'react-router-dom'

import $ from 'jquery';

function Band(){
    const openModalReciept = (e)=>{
        e.preventDefault()
        $('#print_rc').addClass('open');
    }

    const openModalVerify = (e)=>{
        e.preventDefault()
        $('#verify').addClass('open');
    }

    return(
        <div className="center-align card">
            <h1 className="text-animate"><img src='/img/lp.png' alt='tinyPay banner' className='col-md-8 col-lg-4 img' /></h1>

            
                <div className="col-md-8 col-lg-4 text-animate  card">
                    <div className="card-header">More Options.?</div>
                    <div className="card-body row">
                        <Link to='/payment' className="option col-md-12">
                            
                                <i className="fa fa-money-bill fa-5x"></i>
                                <span>Pay Departemt Fee</span>
                            
                        </Link>
                        <Link to="#" onClick={openModalReciept} className="option col-md-6"><span>Request Reciept</span></Link>
                        <Link to="#" onClick={openModalVerify} className="option col-md-6"><span>Verify Payment</span></Link>
                    </div>
                </div>
            

        </div>
    );
}

export default Band;
