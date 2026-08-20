package expo.modules.dlnacast

import expo.modules.core.interfaces.Package

class ExpoDlnaCastPackage : Package {
    override fun createModule(name: String?): expo.modules.core.interfaces.Module? {
        return if (name == "ExpoDlnaCast") {
            ExpoDlnaCastModule()
        } else {
            null
        }
    }
}
