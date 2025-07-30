# Minovative Mind

## An open-source AI agent that automates software development, powerful enough to build itself

A showcase of implementing a complex task: e.g., planning, file creation, and code generation

- [Minovative Mind YouTube Showcase](https://youtu.be/f08_WgmSbUc)

---

## A Tool That Built Itself

This isn't just another AI assistant. Minovative Mind is a living testament to the future of software development.

> **This entire project (as of time of writing, July 29, 2025)—over 33,500 lines of robust, production-ready TypeScript—was developed with a ~90% contribution from the AI agent itself (Minovative Mind) with zero testing.**

It masterfully orchestrated its own creation, architecting intricate and complex systems, generating tens of thousands of lines of code, and seamlessly integrating with VS Code's core APIs while autonomously refining its own work through self-correction. I didn’t merely build an AI agent; I guided its self-construction, leveraging natural language and the power of the Gemini 2.5 Flash model to bring it to life. Smarter models are not always needed for most problems.

Now, that same power is available to you. Completely for free.

## Key Features

- 🧠 **Autonomous Planning & Execution:** Give Minovative Mind a high-level goal. It generates a structured, multi-step plan and executes it, creating files, writing code, and running commands until the job is done.

- 🧩 **Full Workspace Context:** The agent intelligently scans your entire project—respecting your `.gitignore`—to build a deep, accurate understanding of your codebase, ensuring its actions are smart and relevant.

- 🔁 **Automated Self-Correction:** Minovative Mind doesn't just write code; it validates it. By integrating with VS Code's diagnostics, it identifies its own errors and iteratively refines its output until it's functional and error-free.

- 💾 **Integrated Git Automation:** Let the AI do the tedious work. It can automatically stage the changes it makes and generate insightful, descriptive commit messages based on the code diffs.

- ⏪ **Safe & Reversible Changes:** Every file system operation performed by the agent is logged. If you don't like a change, you can easily review and revert the entire operation with a single click, ensuring you are always in control.

- 💰 **Completely Free & Open Source:** No subscriptions, no platform fees. Minovative Mind is licensed under MIT and runs locally in your editor. The only cost is your own usage of the Google Gemini API.

## Quick Start (Get Started in 1-3 minutes)

1. **Install the Extension:** Install directly from your VS Code editor by cloning it then downloading the file

   - Step 1: Clone it and get the project up and running in your VS Code editor

   ```bash
   git clone https://github.com/Minovative-Technologies/minovative-mind.git
   ```

   - Step 2: Run this command in the project terminal

   ```bash
   npm run package
   ```

   - Step 3: Run this command in the project terminal as well

   ```bash
   vsce package
   ```

- **Get Your API Key:**

  - Create a free API key from [**Google AI Studio**](https://aistudio.google.com/app/apikey).

- **Set Your Key in VS Code:**

  - Open VS Code project, press (Windows: `CTRL + ALT + M` or Mac: `CONTROL + CMD + M`) or click on the Minovative Mind icon in sidebar on the left.
  - In the Minovative Mind sidebar, copy and paste your API key in the API Key Management section on the bottom. Build away!

## More Than a Tool—A Platform

Minovative Mind was architected from day one to be an extensible framework. I don't just want you to _use_ it; I want you to _build on it_. Fork/Clone the repository, create your own specialized agents, integrate proprietary tools, MCPs, and push the boundaries of what's possible.

See the [**`CONTRIBUTING.md`**](./CONTRIBUTING.md) to learn how you can use Minovative Mind as a foundation for your own AI-powered solutions.

## The Vision

My goal is to put a powerful, free, and open-source AI developer in every developer's hand. By combining advanced AI with a robust architectural foundation, you can fundamentally change how software is created, making it faster, more accessible, and more creative then what it is already is.

## Join Us

This project thrives on community innovation.

- ⭐ **Star us on GitHub** to show your support!
- 🗣️ **Join the conversation** on our [MM's Discord Server]() or follow us on [X/TWITTER](https://x.com/minovative_tech).

---

> Remember, Minovative Mind is designed to assist, not replace, the brilliance of human developers! Happy Coding!
