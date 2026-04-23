# Contributing to opencode-litellm

Thank you for your interest in contributing! This guide helps ensure a smooth collaboration.

## Development Setup

### Prerequisites
- [Bun](https://bun.sh) (runtime and package manager)
- Git
- Node.js 20+ (for some tooling)

### Local Development

```bash
# Clone the repository
git clone https://github.com/BlakeHastings/opencode-litellm.git
cd opencode-litellm

# Install dependencies
bun install

# Run tests
bun test

# Open in OpenCode for development
opencode open ./.opencode/opencode.json
```

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive names like `feat/model-discovery`, `fix/auth-error`, `chore/update-deps`
2. **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) format
3. **Testing**: Ensure all tests pass before submitting:
   ```bash
   bun test                          # All tests
   bun test tests/unit.test.ts       # Unit tests only
   bun run build && bun test         # Build + test
   ```
4. **Code Style**: Follow existing code formatting (run `bun format` if available)
5. **PR Description**: Clearly describe:
   - What problem you're solving
   - How it was tested
   - Any known limitations or follow-up tasks

## Code Review Process

All PRs require:
- At least one approval from a maintainer
- All CI checks passing (tests, linting)
- No conflicts with the `master` branch

## Reporting Security Issues

If you find a security vulnerability:
1. **DO NOT** create a public GitHub issue
2. Email: [security@anomaly.co](mailto:security@anomaly.co) or open a private security advisory
3. We'll respond within 48 hours and coordinate a responsible disclosure

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) - be respectful, inclusive, and constructive in all interactions.
