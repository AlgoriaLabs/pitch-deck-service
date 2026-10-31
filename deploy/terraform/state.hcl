# Where Terraform keeps its state: a private OCI bucket, shared by your laptop and GitHub Actions.
# Written by `npm run deploy`. Commit it. It holds no credentials.
bucket              = "pitch-deck-agent-tfstate"
namespace           = "frfrtrkivvrb"
region              = "eu-frankfurt-1"
key                 = "pitch-deck-agent.tfstate"
config_file_profile = "DEFAULT"
