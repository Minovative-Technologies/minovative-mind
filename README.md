# Minovative Mind (Now Public!)

## An open-source AI agent that automates software development, powerful enough that it built itself

A showcase of implementing a feature: e.g., planning, file creation, and code generation

- [Minovative Mind YouTube Showcase](https://youtu.be/f08_WgmSbUc)

---

## A Tool That Built Itself

This isn't just another AI assistant. Minovative Mind is a living testament to the future of software development.

> **This entire project—over 35,000 lines of robust, production-ready TypeScript code—was developed with ~90% contribution from the AI agent itself (Minovative Mind), mostly using gemini-2.5-flash, with zero unit testing, no funding ($0), and by one [developer](https://github.com/Quarantiine)...**

It masterfully orchestrated its own creation, architecting intricate and complex systems, generated tens of thousands of lines of code, and seamlessly integrated within VS Code's core APIs while autonomously refining its own work through self-correction. The [Creator](https://github.com/Quarantiine), of this project, didn’t merely build an AI agent; He guided its self-construction, leveraging natural language and the power of the Gemini 2.5 models (Thinking Mode) to bring it to life.

Now...that same power is available to you. Completely for free.

## Key Features

- 🌐 **Real-time Web Knowledge:** Leverages Gemini API's integrated Google Search capabilities to fetch and incorporate up-to-date information from the internet. This enables the agent to provide more relevant, timely, and informed responses by accessing current events, data, and web content.

- 🔗 **Intelligent Link & File Content Processing:** Utilizes the Gemini API's advanced capabilities to parse and understand content directly from URLs. This allows the AI agent to extract crucial information, context, or references from linked resources or file contents, enhancing its comprehension and actionability.

- 🖼️ **Multimodal Input Support:** Engage with the AI using more than just text. Attach image files or paste them directly into the chat interface. The agent processes these images (as Base64 data) alongside your text prompts, enabling richer interactions and visual understanding.

- 🧠 **Autonomous Planning & Execution:** Give Minovative Mind a high-level goal. It generates a structured, multi-step plan and executes it, creating files, writing code, and running commands until the job is done.

- 🧩 **Full Workspace Context:** The agent intelligently scans your entire project—respecting your `.gitignore`—to build a deep, accurate understanding of your codebase, ensuring its actions are smart and relevant.

- 🔁 **Automated Self-Correction:** Minovative Mind doesn't just write code; it validates it. By integrating with VS Code's diagnostics, it identifies its own errors and iteratively refines its output until it's functional and error-free.

- 💾 **Integrated Git Automation:** Let the AI do the tedious work. It can automatically stage the changes it makes and generate insightful, descriptive commit messages based on the code diffs.

- ⏪ **Safe & Reversible Changes:** Every file system operation performed by the agent is logged. If you don't like a change, you can easily review and revert the entire operation with a simple 2-click button, ensuring you are always in control.

- 💰 **Completely Free & Open Source:** No subscriptions, no platform fees. Minovative Mind is licensed under MIT and runs locally in your system. The only cost is your own usage of the Google Gemini API that you control.

See more in the [**`CAPABILITIES.md`**](./CAPABILITIES.md) file

## Quick Start (Get Started in 1-3 minutes)

### ✅ Summary

- ***Minovative Mind performs better for files <1500 lines of code***

| Step | Description                                     |
| ---- | ----------------------------------------------- |
| 1    | Clone the repository                            |
| 2    | Install project dependencies with `npm install` |
| 3    | Generate `.vsix` using `npx vsce package`       |
| 4    | Install the extension via GUI or `code` CLI     |

Here's the cleaned-up version in **Markdown** format, ready to paste into your `README.md`:

---

## 🔧 How to Clone the Minovative Mind Extension from GitHub to Use

### **Step 1: Clone the Repository**

```bash
git clone https://github.com/Minovative-Technologies/minovative-mind.git
cd minovative-mind
git remote remove origin
```

### **Step 2: Install Dependencies**

Make sure you have **Node.js** and **npm** installed, then run:

```bash
npm install
```

### **Step 3: Package the Extension**

Use the following command to package the extension:

```bash
npx vsce package
```

> This will generate a `.vsix` file, such as:
> `minovative-mind-1.2.3.vsix`
> If `vsce` is not installed, you can install it globally:
>
> ```bash
> npm install -g @vscode/vsce
> ```

### **Step 4: Install the Extension in VS Code**

You have two options:

#### **Option A: Using the GUI**

1. Open VS Code.
2. Go to the extension file `minovative-mind-1.2.3.vsix`, right click it.
3. Choose **“Install Extension VSIX”**.

#### **Option B: Using the Command Line**

```bash
code --install-extension minovative-mind-1.2.3.vsix
```

> If the `code` command isn't available, [enable it from the command palette](https://code.visualstudio.com/docs/setup/mac#_launching-from-the-command-line).

---

### Step 5: API Key Setup

- **Get Your API Key:**

  - Create a free API key from [**Google AI Studio**](https://aistudio.google.com/app/apikey).

- **Set Your Key in VS Code:**

  - Open VS Code project

    - press (Windows: `CTRL + ALT + M` or Mac: `CONTROL + CMD + M`) or click on the Minovative Mind icon in sidebar on the left.

  - In the Minovative Mind sidebar, copy and paste your API key in the API Key Management section on the bottom.

For a better experience, you could move the Minovative Mind extension from the primary bar to the secondary bar by right clicking the Minovative Mind icon. After right clicking, go to "Move To" > "Secondary Side Bar".

## More Than a Tool—It's A Platform

Minovative Mind was architected from day one to be an extensible tool. We don't just want you to _use_ it; We want you to _build on it_. Fork/Clone the repository, create your own specialized agents, integrate proprietary tools, MCPs, or anything else you can think of and push the boundaries of what's possible.

See the [**`CONTRIBUTING.md`**](./CONTRIBUTING.md) to learn how you can use Minovative Mind as a foundation for your own AI-powered solutions.

## The Vision

My vision is to empower every developer with a powerful, free, and open-source AI Agent dev tool. By integrating cutting-edge AI models with a robust architectural framework, we can revolutionize software development, making it faster, more accessible, and unleash unprecedented creativity.

## 🙌 Join US! How to Support

- ⭐ **Star us on GitHub** to show your support!
- 💖 **Support development** on [Patreon](https://www.patreon.com/c/minovativetechnologies/membership) — every contribution can help us grow!
- 🗣️ **Join the conversation** on our [Minovative Mind Discord](https://discord.gg/KFkMgAH3EG) or follow us on [X/Twitter](https://x.com/minovative_tech).

## Other things about this project

- [**`CONTRIBUTING.md`**](./CONTRIBUTING.md)
- [**`CAPABILITIES.md`**](./CAPABILITIES.md)
- [**`ARCHITECTURE.md`**](./ARCHITECTURE.md)
- [**`ROADMAP.md`**](./ROADMAP.md)
- [**`CODE_OF_CONDUCT.md`**](./CODE_OF_CONDUCT.md)
- [**`LICENSE.md`**](./LICENSE.md)
- [**`SECURITY.md`**](./SECURITY.md)
- [**`GOOGLE_AI_POLICIES.md`**](./GOOGLE_AI_POLICIES.md)

---

> Remember, Minovative Mind is designed to assist, not replace, the brilliance of human developers! Happy Coding!
