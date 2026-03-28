// Node.js (inside Lambda)
// This function takes in an input of a unique index from our RDS database
// then it fetches through the database to find the corresponding property listing url.
// This url is fed into the lambda function scrape_rightmove_contact_number_from_url
// to generate a number to call. Finally, we pull all this information to feed into 11labs
// so a call is made and the corresponding record is saved back into the database. 

//input isn't complete, we need a second layer to pass user details from app to elevenlabs

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda_client = new LambdaClient({ region: "us-east-1" });
const { Pool } = require('pg');

const { ElevenLabsClient, ElevenLabsEnvironment } = require("elevenlabs");

// // TODO
// function call_11labs(){
//     return "called";
// }

// setup RDS PostgresSQL database
const pool = new Pool({
  host: process.env.DB_HOST,       // RDS/proxy endpoint
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
  console.log("received event", event)
  const client = await pool.connect();
  let listing_link;
  let queried_listing;
  let user_name, user_phone_number, user_email, user_address, knowledge_base, user_availability;

  // retrieve all user information and property unique index from the app
  const body = event.body ? JSON.parse(event.body) : {}
  const unique_index = event.queryStringParameters?.unique_index ?? body.unique_index
  const app_call_id = event.queryStringParameters?.call_id ?? body.call_id

  console.log("app_call_id", app_call_id)
  console.log("unique_index", unique_index)

  // const user_name = event.queryStringParameters.user_name;
  // const user_phone_number = event.queryStringParameters.phone_number;
  // const user_email = event.queryStringParameters.user_email;
  // const user_address = event.queryStringParameters.user_address;
  // const knowledge_base = event.queryStringParameters.knowledge_base;
  // const user_availability = event.queryStringParameters.user_availability;
  try {
    user_info = await client.query(`SELECT * FROM opportunities WHERE active='t'`);
    queried_user = user_info.rows[0]
    user_name = queried_user.name;
    user_phone_number = queried_user.phone;
    user_email = queried_user.email;
    user_address = queried_user.address;
    knowledge_base = queried_user.knowledge_base;
    user_availability = queried_user.availability;
    
    //return { statusCode: 200, body: JSON.stringify(res.rows) };
  } catch{
    return { statusCode: 400, body: JSON.stringify('Error: no user info') }
  }

  //take an input of the unique index of the property and selects it from the database

  try {
    const query_res = await client.query(`SELECT * FROM properties WHERE unique_index='${unique_index}'`);
    queried_listing = query_res.rows[0]
    listing_link = queried_listing.link
    console.log("listing link", listing_link)
    //return { statusCode: 200, body: JSON.stringify(res.rows) };
  } finally {
    client.release();
  }

  // after we have the listing link, we call the scrape function to get the contact number
  const response = await lambda_client.send(new InvokeCommand({
    FunctionName: "scrape_rightmove_contact_number_from_url",        // or full ARN
    InvocationType: "RequestResponse",        // synchronous (waits for response)
    Payload: JSON.stringify({ "queryStringParameters": { "url": listing_link }}) // your payload
  }));
  console.log(response)
  // Parse the response
  const result = JSON.parse(Buffer.from(response.Payload).toString());
  //return { statusCode: 200, body: JSON.stringify(result) };
  console.log("result", result)
  console.log("result.body", result.body)
  const contact_number = result.body?.number
  console.log("contact number", contact_number)

  //retrieve all property information before calling 11labs
  const address = queried_listing.address
  const asking_price = queried_listing.price;
  const offer = asking_price * 0.8;
  const num_beds = queried_listing.num_beds;

  const dynamicVariables = {
    "address":             address            || "",
    "asking_price":        asking_price       || "",
    "offer":               offer              || "",
    "user_name":           user_name          || "",
    "user_phone_number":   user_phone_number  || "",
    "user_email":          user_email         || "",
    "user_address":        user_address       || "",
    "knowledge_base":    knowledge_base     || "-",
    "num_beds":            num_beds           || "",
    "user_availability":   user_availability  || "",
    "unique_index":        unique_index       || "",
    "app_call_id":         app_call_id        || "-"
  }

  const eleven_labs_response = await call_elevenlabs(contact_number, dynamicVariables, process.env.TESTING_ONLY);
  //return({"status": 200, "dynamicVariables": dynamicVariables})
  return {
    statusCode: 200, 
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify({
        "message": "success",
        "contact_number": contact_number,
        "dynamic_variables": dynamicVariables
      }
    )
  }
};

async function call_elevenlabs(contact_number, dynamic_variables,testing_only){
  contact_number = testing_only == "true" ? "+447384058174" : contact_number;
  console.log("contact_number", contact_number)
  // const elevenlabs_client = new ElevenLabsClient({
  //   environment: ElevenLabsEnvironment.PRODUCTION,
  //   apiKey: process.env.ELEVENLABS_API_KEY
  // });
  // try{
  //   console.log(Object.keys(elevenlabs_client));
  //   console.log(Object.keys(elevenlabs_client.conversationalAi));
  //   await elevenlabs_client.conversationalAi.twilio.outboundCall({
  //     toNumber: contact_number,
  //     agentId: "agent_7601kfbj3w7sfq3r75razffyjwtm",
  //     agentPhoneNumberId: "phnum_5701kj1dxcnre639swf9079rqf8p",
  //     conversationInitiationClientData: {
  //         "dynamic_variables": dynamic_variables
  //       }
  //   })   
  // }catch(e){
  //   console.log(e)
  // }

  //tried using elevenlabs SDK but didn't work, use normal API instead
  try{
    const eleven_labs_api_call = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: "agent_7601kfbj3w7sfq3r75razffyjwtm", // Johnson BMV BOT
        //agent_id: "agent_4001kjnr22erecbttk1p70bammvm",  // Johnson BMV BOT - Kevin Demo
        //agent_id: "agent_4301kk40yysnftq8nrhzqbwgc4e8",   // Johnson Booking Bot - Admit it's AI
        agent_phone_number_id: process.env.AGENT_PHONE_NUMBER_ID,
        to_number: contact_number,
        conversation_initiation_client_data: {
          dynamic_variables: dynamic_variables
        }
      })
    });
    const eleven_labs_api_call_result = await eleven_labs_api_call.json();
    console.log("ElevenLabs response:", eleven_labs_api_call_result);
    return eleven_labs_api_call_result;
  } catch(e){
    console.error("Error calling ElevenLabs:", e);
  }

}