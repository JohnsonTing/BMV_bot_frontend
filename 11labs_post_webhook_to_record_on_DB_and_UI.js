const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,       // RDS/proxy endpoint
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function insert_call_into_db(conversation_id, transcript, summary, app_calL_id) {
  console.log("inserting into db...")
  console.log("conversation_id", conversation_id)

  const db_client = await pool.connect();
  try {
    const user_info = await db_client.query(
      `UPDATE calls SET summary = $1, transcript = $2, elevenlabs_conversation_id = $3 WHERE id = $4 returning *`,
      [summary, transcript, conversation_id, app_calL_id]
    );
    const queried_user = user_info.rows[0]
    const user_name = queried_user.name;
    const user_phone_number = queried_user.phone;
    const user_email = queried_user.email;
    const user_address = queried_user.address;
    const knowledge_base = queried_user.knowledge_base;
    const user_availability = queried_user.availability;
    
    return("Successfully plugged in summary, transcript, and conversation id into the calls database");
  } catch(e){
    console.log("Failed to plug in summary, transcript, and conversation id into the calls database")
    console.error(e)
    return("Failed to plug in summary, transcript, and conversation id into the calls database")
  }finally {
    db_client.release();
  }
}

exports.handler = async (event) => {

  let transcript;
  let result;

  // TODO implement
  console.log("Elevenlabs called")
  console.log("event", event)
  const body = JSON.parse(event.body);
  const conversation_id = body.data.conversation_id;
  console.log("conversation_id", conversation_id)
  const unique_index = body.data.conversation_initiation_client_data.dynamic_variables.unique_index
  console.log("unique_index", unique_index  )
  const app_call_id = body.data.conversation_initiation_client_data.dynamic_variables.app_call_id
  console.log("app_call_id", app_call_id)

  console.log("Retrieving conversation...")
  try{
    await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
    const convo_data = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}?xi-api-key=0ce79608c65705cfe76ed13fcfebbe809617e8061bdd28864af9254a533ead7e`, 
      {
        method: "GET",
        headers: { 
          "Content-Type": "application/json",
          "xi-api-key": "0ce79608c65705cfe76ed13fcfebbe809617e8061bdd28864af9254a533ead7e" }
        } 
    )
    console.log(convo_data)
    const convo_json = await convo_data.json()
    console.log("convo_json", convo_json)
  
    transcript = convo_json.transcript
    .filter(turn => turn.message)
    .map(turn => `${turn.role.toUpperCase()=="AGENT" ? "BOT" : "AGENCY"}: ${turn.message}`)
    .join('\n');
    result = convo_json.analysis.transcript_summary
  
    console.log(transcript)
  } catch(e){
    console.error(e)
  }


  try{
    console.log("Attempting to plug into db")
    const seed_db = await insert_call_into_db(conversation_id, transcript, result, app_call_id)

    const response = {
      statusCode: 200,
      body: {
        unique_index: unique_index,
        transcript: `${transcript}`,
        summary: result,
        plugged_into_db: seed_db
      }
    };
    console.log("response", response)
    return response;
  }catch(e){
    const response = {
      statusCode: 500,
      body: {
        unique_index: unique_index,
        transcript: `Failed to load transcript`,
        summary: `Failed to load summary`,
        plugged_into_db: `Failed to plug into db`
      }
    };
    console.log("response", response)

    console.error("DB insert failed:", e)
  }
};
