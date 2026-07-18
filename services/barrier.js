//Funciton to open the barrier
const dotenv = require('dotenv');
dotenv.config();

const entrybarrierip = process.env.ENTRY_BARRIER_IP;
const exitbarrierip = process.env.EXIT_BARRIER_IP;

const openbarrier = async (barrier) => {

    //name
    const name = barrier === 1 ? 'Entry Barrier' : barrier === 2 ? 'Exit Barrier' : 'Unknown Barrier';

    try {
        let barrierIp;
        if (barrier === 1) {
            barrierIp = entrybarrierip;
        } else if (barrier === 2) {
            barrierIp = exitbarrierip;
        } else {
            throw new Error('Invalid barrier');
        }

        // Logic to open the barrier using barrierIp
        // For example, you might send an HTTP request to the barrier IP
        console.log(`${name} at IP ${barrierIp} is opened...`);

    } catch (error) {
        console.error('Error opening barrier:', error);
        throw error;
    }
};

module.exports = openbarrier;