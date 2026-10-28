# ─── Oracle Cloud ────────────────────────────────────────────────────────────

variable "oci_profile" {
  description = "Profile name in ~/.oci/config"
  type        = string
  default     = "DEFAULT"
}

variable "region" {
  description = "Your OCI home region (Always Free A1 runs only there), e.g. eu-frankfurt-1"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment for everything. Your tenancy OCID (root compartment) is fine."
  type        = string
}

variable "availability_domain_index" {
  description = "0, 1 or 2. Change it if you get 'Out of host capacity'."
  type        = number
  default     = 0
}

variable "ocpus" {
  description = "Ampere A1 OCPUs. Stay inside your Always Free allowance (check the OCI console)."
  type        = number
  default     = 2
}

variable "memory_gb" {
  description = "Ampere A1 memory in GB. Stay inside your Always Free allowance."
  type        = number
  default     = 12
}

variable "boot_volume_gb" {
  type    = number
  default = 50
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_private_key_path" {
  description = "Used by Terraform to upload the app over SSH."
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_allowed_cidr" {
  description = "Who may SSH in. Put your own IP/32 here."
  type        = string
  default     = "0.0.0.0/0"
}

# ─── Public address ──────────────────────────────────────────────────────────

variable "domain" {
  description = "Hostname pointing at the VM, e.g. deck.example.com. Empty: <ip>.sslip.io (fine for testnet)."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "Email for Let's Encrypt certificate notices."
  type        = string
}

# ─── The switch ──────────────────────────────────────────────────────────────

variable "stellar_network" {
  description = "testnet or mainnet. Change this one line and `terraform apply` to switch."
  type        = string
  default     = "testnet"
  validation {
    condition     = contains(["testnet", "mainnet"], var.stellar_network)
    error_message = "stellar_network must be \"testnet\" or \"mainnet\"."
  }
}

variable "price_usdc" {
  type    = string
  default = "0.10"
}

# Per-network values. Fill in mainnet ones when you're ready; they're ignored on testnet.

variable "pay_to_testnet" {
  description = "Public G... address that receives testnet USDC (never a secret key)"
  type        = string
}

variable "pay_to_mainnet" {
  type    = string
  default = ""
}

variable "agent_id_testnet" {
  description = "8004 agent id after `npm run kit -- register`. Empty until then."
  type        = string
  default     = ""
}

variable "agent_id_mainnet" {
  type    = string
  default = ""
}

variable "soroban_rpc_url_mainnet" {
  description = "Mainnet has no default public RPC; pick one from developers.stellar.org/docs/data/apis/rpc/providers"
  type        = string
  default     = ""
}

variable "facilitator_api_key_mainnet" {
  description = "OpenZeppelin x402 facilitator API key (channels.openzeppelin.com/gen)"
  type        = string
  default     = ""
  sensitive   = true
}

# ─── LLMs and GitHub (free tiers) ────────────────────────────────────────────

variable "gemini_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "groq_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "openrouter_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_token" {
  description = "Fine-grained token with no permissions (public read). Lifts GitHub's limit from 60 to 5,000 requests/hour."
  type        = string
  default     = ""
  sensitive   = true
}
