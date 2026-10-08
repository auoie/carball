// Decompiles functions to out/decomp/<name>.c.
// Args: one or more targets, each a hex address (0x...), a symbol name (Class::func or func),
// or a regex prefixed with "re:" matched against the function's full name.
// @category RocketLeague
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

import ghidra.app.decompiler.*;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;

public class Decomp extends GhidraScript {
	@Override
	protected void run() throws Exception {
		// out/decomp next to this script's folder (scripts/../out/decomp), wherever the repository is
		Path outDir = Paths.get(getSourceFile().getParentFile().getAbsolutePath()).resolve("../out/decomp").normalize();
		Files.createDirectories(outDir);

		Set<Function> targets = new LinkedHashSet<>();
		for (String arg : getScriptArgs()) {
			if (arg.startsWith("0x")) {
				Address a = toAddr(Long.decode(arg));
				Function f = getFunctionContaining(a);
				if (f == null) {
					disassemble(a);
					f = createFunction(a, null);
				}
				if (f != null) {
					targets.add(f);
				}
				else {
					println("no function at " + arg);
				}
			}
			else if (arg.startsWith("re:")) {
				Pattern p = Pattern.compile(arg.substring(3));
				for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
					if (p.matcher(f.getName(true)).find()) {
						targets.add(f);
					}
				}
			}
			else {
				for (Function f : getGlobalFunctionsOrQualified(arg)) {
					targets.add(f);
				}
			}
		}

		DecompInterface ifc = new DecompInterface();
		DecompileOptions opts = new DecompileOptions();
		ifc.setOptions(opts);
		ifc.toggleCCode(true);
		ifc.openProgram(currentProgram);
		for (Function f : targets) {
			DecompileResults r = ifc.decompileFunction(f, 120, monitor);
			String name = f.getName(true).replaceAll("[^A-Za-z0-9_.:-]", "_").replace("::", "__");
			String body = r.decompileCompleted() ? r.getDecompiledFunction().getC()
					: "/* decompile failed: " + r.getErrorMessage() + " */";
			String header = "// " + f.getName(true) + " @ " + f.getEntryPoint() + "\n";
			Files.writeString(outDir.resolve(name + "@" + f.getEntryPoint() + ".c"), header + body);
		}
		ifc.dispose();
		println("Decomp: wrote " + targets.size() + " functions to " + outDir);
	}

	private List<Function> getGlobalFunctionsOrQualified(String name) {
		List<Function> out = new ArrayList<>();
		for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
			if (f.getName(true).equals(name) || f.getName().equals(name)) {
				out.add(f);
			}
		}
		return out;
	}
}
