import {useState} from 'react';
import { useFlutterwave, closePaymentModal } from 'flutterwave-react-v3';


function PaymentForm()
{
	
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [phone, setPhone] = useState('');
	const [amount, setAmount] = useState();

	const config = {
    public_key: "FLWPUBK_TEST-70e05402741f9baf2c17e85880ed64f2-X",
    tx_ref: "TX"+new Date().getTime()+"NPC_BK",
    amount : amount,
    currency: "NGN",
    payment_options: " ",
    redirect_url: "https://tinypay.netlify.app",
    meta: {
      amount : amount,
    },
    customer: {
      email: email,
      phone_number: phone,
      name: name,
    },
    callback: function (data) {
      alert("Transaction has been processed you will recieve and email notification at "+email)
    },
    onclose: function() {
      // close modal
    },
    customizations: {
      title: "Nacos Plasu",
      description: "Payment for Departmental Dues",
      logo: "/img/nacos.jpg",
    },
				    
  };

  const handleFlutter = useFlutterwave(config);

	const handleData = (e)=>{
		
		// data[e.target.name] = e.target.value

		return e;
		
	}

	const SubmitData = e=>{
		e.preventDefault();
		console.log(config)
		handleFlutter({
			callback : resp=>{
				console.log(resp);
				closePaymentModal();
			},
			onClose : ()=>{}
		})
	}

	return (<>
		<section id='hero' className='d-flex align-items-center justify-content-center contact section-bg'>
		  <div className="col-lg-6 mt-4 mt-md-0">
        <form onSubmit={SubmitData} className="php-email-form">

        	<div className='row'>
	          <div className="col mb-3">
	            <select className="form-control text-center" onChange={handleData} name="dept" required >
	            	<option value=''>Who Do you Want to Pay</option>
	            	<option value='merchant'>Computer Science Department PLASUB</option>
	            </select>
	          </div>
	        </div>
          <div className="row mb-2">
            <div className="col-md-6 form-group">
              <input type="text" name="name" onChange={(e)=>setName(e.target.value)} className="form-control" placeholder="Your Name" required />
            </div>
            <div className="col-md-6 form-group mt-3 mt-md-0">
              <input type="email" className="form-control" onChange={(e)=>setEmail(e.target.value)} name="email" placeholder="Your Email" required />
            </div>
          </div>

          <div className="row mt-3">
            <div className="col-md-6 form-group">
              <input type="tel" name="phone" onChange={(e)=>setPhone(e.target.value)} className="form-control"  placeholder="Your Phone Number" required />
            </div>
            <div className="col-md-6 form-group mt-3 mt-md-0">
              <select className="form-control text-center" onChange={(e)=>setAmount((e.target.value === 'new')?3700:2200)} name="amount" required >
              	<option value=''>---Select amount---</option>
              	<option value='new'>For New Student</option>
              	<option value='old'>For Old Student</option>
              </select>
            </div>
          </div>
          
          <div className="text-center"><button className='mt-3' type="submit">Continue</button></div>
        </form>
      </div>
		</section>;
		</>
	);
}


export default PaymentForm;