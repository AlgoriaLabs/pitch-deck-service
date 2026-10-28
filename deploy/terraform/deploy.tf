# Ships the app to the VM on every `terraform apply` where something changed: the code (zipped from
# this repo), the env file (including the testnet/mainnet switch) or the Caddyfile. No new VM, no
# lost jobs: the job databases live in /var/lib/pitch-deck-agent and survive deploys.

locals {
  public_ip = oci_core_public_ip.app.ip_address
  domain    = var.domain != "" ? var.domain : "${replace(local.public_ip, ".", "-")}.sslip.io"
  origin    = "https://${local.domain}"

  env = templatefile("${path.module}/templates/env.tftpl", {
    stellar_network             = var.stellar_network
    public_origin               = local.origin
    price_usdc                  = var.price_usdc
    pay_to_testnet              = var.pay_to_testnet
    pay_to_mainnet              = var.pay_to_mainnet
    agent_id_testnet            = var.agent_id_testnet
    agent_id_mainnet            = var.agent_id_mainnet
    soroban_rpc_url_mainnet     = var.soroban_rpc_url_mainnet
    facilitator_api_key_mainnet = var.facilitator_api_key_mainnet
    gemini_api_key              = var.gemini_api_key
    groq_api_key                = var.groq_api_key
    openrouter_api_key          = var.openrouter_api_key
    github_token                = var.github_token
  })

  caddyfile = templatefile("${path.module}/templates/Caddyfile.tftpl", {
    domain     = local.domain
    acme_email = var.acme_email
  })
}

data "archive_file" "app" {
  type        = "zip"
  source_dir  = "${path.module}/../.."
  output_path = "${path.module}/.build/app.zip"
  excludes = [
    ".git", ".git/**", "node_modules/**", "dist/**", "dist-test/**", "vendor/**", "data/**",
    ".env", "*.pptx", "deploy/terraform/.terraform/**", "deploy/terraform/.build/**",
    "deploy/terraform/terraform.tfvars", "deploy/terraform/*.tfstate*", "deploy/terraform/.terraform.lock.hcl",
  ]
}

resource "terraform_data" "deploy" {
  # Only hashes go into state, never the env file's secrets.
  triggers_replace = [
    oci_core_instance.app.id,
    data.archive_file.app.output_sha256,
    sha256(local.env),
    sha256(local.caddyfile),
    filesha256("${path.module}/scripts/deploy-on-host.sh"),
  ]

  connection {
    type        = "ssh"
    host        = local.public_ip
    user        = "ubuntu"
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "10m"
  }

  # First boot: wait until cloud-init has installed Node and Caddy.
  provisioner "remote-exec" {
    inline = ["cloud-init status --wait >/dev/null || true", "cloud-init status || true", "command -v node caddy"]
  }

  provisioner "file" {
    source      = data.archive_file.app.output_path
    destination = "/tmp/pitch-deck-agent.zip"
  }

  provisioner "file" {
    content     = local.env
    destination = "/tmp/pitch-deck-agent.env"
  }

  provisioner "file" {
    content     = local.caddyfile
    destination = "/tmp/Caddyfile"
  }

  provisioner "file" {
    source      = "${path.module}/scripts/deploy-on-host.sh"
    destination = "/tmp/deploy-on-host.sh"
  }

  provisioner "remote-exec" {
    inline = ["sudo bash /tmp/deploy-on-host.sh"]
  }
}
