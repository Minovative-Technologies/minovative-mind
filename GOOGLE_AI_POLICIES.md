# Purpose

This document outlines the core policies, terms, and principles for the responsible integration, usage, and development of Google AI and Gemini-powered features within this project. All contributors, maintainers, and users must comply with the referenced Google policies and best practices to ensure safety, legality, and ethical stewardship of AI technology.

## Table of Contents

- [1. Google AI Principles and Responsible AI Commitments](#1-google-ai-principles-and-responsible-ai-commitments)
- [2. Acceptable and Prohibited Uses](#2-acceptable-and-prohibited-uses)
- [3. Terms of Service & Privacy](#3-terms-of-service--privacy)
- [4. Security, Data Retention, and Abuse Monitoring](#4-security-data-retention-and-abuse-monitoring)
- [5. Product Integration Guidelines](#5-product-integration-guidelines)
- [6. Reporting Issues and Security Vulnerabilities](#6-reporting-issues-and-security-vulnerabilities)
- [7. Additional Resources](#7-additional-resources)

## 1. Google AI Principles and Responsible AI Commitments

Google’s AI is governed by the [AI Principles](https://ai.google/principles/) and ongoing [Responsible AI governance](https://cloud.google.com/responsible-ai). These commitments guide the ethical development, deployment, and continual evaluation of AI systems, emphasizing:

- **Safety and accountability**
- **Human-centered design**
- **Transparency and explainability**
- **Privacy and data protection**
- **Fairness and prevention of bias**

Read more:

- [Google AI Principles](https://ai.google/principles/)
- [Responsible AI - Google Cloud](https://cloud.google.com/responsible-ai)
- [Google’s Secure AI Framework (SAIF)](https://safety.google/cybersecurity-advancements/saif/)

## 2. Acceptable and Prohibited Uses

All project artifacts, integrations, and user interactions with Google Gemini or other generative AI models must adhere to Google’s [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy). In summary, **prohibited uses include** (but are not limited to):

- Unlawful or exploitative activities
- Generating harmful, misleading, or deceptive content (including electoral misinformation)
- Bullying, harassment, or creation of harmful code
- Scams, deepfake abuse, and non-consensual data use
- Content that violates privacy, intellectual property, or encourages self-harm

For further details:

- [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy)
- [Google Play AI-Generated Content Policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en)

## 3. Terms of Service & Privacy

By using Google Gemini or related APIs, you agree to:

- [Google Terms of Service](https://policies.google.com/terms)
- [Generative AI Additional Terms](https://policies.google.com/terms/generative-ai)
- [Google Privacy Policy](https://policies.google.com/privacy)

Developers and users must review and comply with the policies regarding the collection, use, retention, and security of data.  
For enhanced policy clarity, refer to:

- [Privacy Policy, Terms of Service, and AI](https://transparency.google/intl/en_us/our-policies/privacy-policy-terms-of-service/)

## 4. Security, Data Retention, and Abuse Monitoring

Google Cloud and Gemini platforms implement [robust security frameworks](https://safety.google/cybersecurity-advancements/saif/). Notably:

- Data submitted to Google Gemini is not used to train models without explicit user opt-in.
- Input and output data may be cached for up to 24 hours by default to improve user experience and diagnostics, unless data caching is disabled at the project level.
- Users and organizations seeking total zero data retention can reference specific measures:
  - [Generative AI Data Governance & Zero Data Retention](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)

## 5. Product Integration Guidelines

When integrating Google Generative AI, developers must:

- Set up API keys securely and never commit them to public repositories.
- Clearly notify users when Gemini or other AI models generate content.
- Stay up-to-date with best practices for responsible AI use and content moderation:
  - [Responsible Generative AI Toolkit](https://ai.google.dev/responsible)
  - [Gemini Code Assist and Permission Management](https://developers.google.com/gemini-code-assist/docs/review-github-code)

## 6. Reporting Issues and Security Vulnerabilities

All security concerns or potential AI policy violations should be reported through the channels below:

- [Google Security Vulnerability Reporting](https://g.co/vulnz)
- For project-related incidents, follow the standard reporting procedures outlined in CONTRIBUTING.md.

## 7. Additional Resources

- [Responsible AI Progress Reports](https://blog.google/technology/ai/responsible-ai-2024-report-ongoing-work/)
- [Google Public Policy and Responsible AI](https://publicpolicy.google/responsible-ai/)

### Disclaimer

This document is a summary of Google’s official policies and must be used in conjunction with the latest policy links above. Google’s official terms and policies always take precedence.

_For questions about these policies, open an issue in this repository or contact the project maintainers._

[1] [https://ai.google/public-policy-perspectives/](https://ai.google/public-policy-perspectives/)
[2] [https://ai.google/principles/](https://ai.google/principles/)
[3] [https://policies.google.com/terms/generative-ai/use-policy](https://policies.google.com/terms/generative-ai/use-policy)
[4] [https://transparency.google/intl/en_us/our-policies/privacy-policy-terms-of-service/](https://transparency.google/intl/en_us/our-policies/privacy-policy-terms-of-service/)
[5] [https://support.google.com/googleplay/android-developer/answer/14094294?hl=en](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en)
[6] [https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
[7] [https://safety.google/cybersecurity-advancements/saif/](https://safety.google/cybersecurity-advancements/saif/)
[8] [https://blog.google/technology/ai/responsible-ai-2024-report-ongoing-work/](https://blog.google/technology/ai/responsible-ai-2024-report-ongoing-work/)
[9] [https://developers.google.com/gemini-code-assist/docs/review-github-code](https://developers.google.com/gemini-code-assist/docs/review-github-code)
[10] [https://cloud.google.com/responsible-ai](https://cloud.google.com/responsible-ai)
[11] [https://developers.google.com/search/blog/2023/02/google-search-and-ai-content](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content)
[12] [https://gist.github.com/jacobdjwilson/3ac300ea4e768d8c4bb53de461307144](https://gist.github.com/jacobdjwilson/3ac300ea4e768d8c4bb53de461307144)
[13] [https://ai.google.dev/responsible](https://ai.google.dev/responsible)
[14] [https://publicpolicy.google/responsible-ai/](https://publicpolicy.google/responsible-ai/)
[15] [https://github.com/GoogleCloudPlatform/generative-ai/security/policy](https://github.com/GoogleCloudPlatform/generative-ai/security/policy)
[16] [https://blog.google/outreach-initiatives/public-policy/7-principles-for-getting-ai-regulation-right/](https://blog.google/outreach-initiatives/public-policy/7-principles-for-getting-ai-regulation-right/)
[17] [https://policies.google.com/terms/generative-ai](https://policies.google.com/terms/generative-ai)
[18] [https://github.com/GoogleCloudPlatform/policy-library](https://github.com/GoogleCloudPlatform/policy-library)
[19] [https://publicpolicy.google](https://publicpolicy.google)
[20] [https://github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
