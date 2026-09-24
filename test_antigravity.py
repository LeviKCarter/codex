import asyncio
from google.antigravity import Agent, LocalAgentConfig

async def main():
    config = LocalAgentConfig()

    async with Agent(config) as agent:
        response = await agent.chat(
            "Inspect this workspace and tell me what this project does."
        )

        print(await response.text())

if __name__ == "__main__":
    asyncio.run(main())