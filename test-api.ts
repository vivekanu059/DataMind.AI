async function testAIAnalyst() {
    console.log("Sending request to AI Analyst Agent...");

    
    
    try {
        const response = await fetch('http://localhost:3000/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: "Which region generated the most revenue, and what were the top products there?",
                fileLocation: "uploads/sample_data.csv"
            })
        });

        const data = await response.json();
        
        // Print the result cleanly to the terminal
        console.dir(data, { depth: null, colors: true });
    } catch (error) {
        console.error("Test failed:", error);
    }
}

testAIAnalyst();