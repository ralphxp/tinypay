
import {Routes, Route} from 'react-router-dom';
import PaymentForm from './payment';

function Main()
{
	return(
		<main id='main'>
				<Routes>
					<Route path='/payment' exact element={<PaymentForm />} />
				</Routes>
		</main>
	);
}

export default Main;