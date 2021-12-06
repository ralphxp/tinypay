<?php 



$curl = curl_init();


if(isset($_REQUEST['validate']))
{

	$SEC_KEY = "FLWSECK_TEST-f3ed6a94918305960db00d15a34052ce-X";
	$tx_id = strval($_REQUEST['tx_id']);
  try{
		curl_setopt_array($curl, array(
		    CURLOPT_URL => "https://api.flutterwave.com/v3/transactions/".$tx_id."/verify",
		    CURLOPT_RETURNTRANSFER => true,
		    CURLOPT_ENCODING => "",
		    CURLOPT_MAXREDIRS => 10,
		    CURLOPT_TIMEOUT => 0,
		    CURLOPT_FOLLOWLOCATION => true,
		    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
		    CURLOPT_CUSTOMREQUEST => "GET",
		    CURLOPT_HTTPHEADER => array(
		        "Content-Type: application/json",
		        "Authorization: Bearer ".$SEC_KEY
		    ),
		));

		$resp= curl_exec($curl);

		curl_close($curl);

		echo($resp);

	}catch (Exception $e) {
		echo json_encode(['status'=>"fail", 'msg' => json_encode($e)]);
	}
}