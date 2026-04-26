object "Ghostcall" {
    code {
        // Ghostcall is an "initcode program" rather than a normal deployed contract.
        //
        // Mental model:
        // 1. A normal CREATE transaction executes initcode.
        // 2. That initcode usually builds runtime bytecode and RETURNs it.
        // 3. Ghostcall uses the same mechanism, but inside eth_call.
        // 4. Because this is only a simulation, nothing is deployed.
        // 5. Whatever bytes this program RETURNs become the eth_call result.
        //
        // In other words: Ghostcall treats CREATE initcode like a tiny one-shot program that can
        // batch external CALLs and return their raw results.
        //
        // The caller sends one byte blob:
        //   <compiled ghostcall initcode><payload>
        //
        // The payload is appended directly after the compiled initcode. It is not normal calldata.
        // This program reads that appended payload back out of its own code using CODECOPY.
        //
        // Payload layout:
        //   repeated call entries
        //
        // Each call entry:
        //   20 bytes  target address
        //    2 bytes  calldata length (big-endian uint16)
        //    N bytes  calldata
        //
        // Output layout:
        //   repeated result entries
        //
        // Each result entry:
        //    2 bytes  packed header
        //             bit 15    = success flag from CALL
        //             bits 0-14 = returndata length (big-endian uint15)
        //    N bytes  returndata
        //
        // The program does the same high-level loop for every entry:
        // - read the next target + calldata length
        // - copy that call's calldata into memory
        // - execute CALL(target, calldata)
        // - append (success, returndata) to the response buffer
        // - continue until the payload is fully consumed
        //
        // The SDK is expected to validate most caller-facing invariants ahead of time. The checks
        // left in this file exist only to protect parser correctness and response packing.

        let maxEntrySize := 0x7fff
        let callHeaderSize := 0x16

        // dataoffset("user_payload_anchor") is the byte offset of the empty data section declared at
        // the bottom of this file. Because that data section is placed after the code, its offset is
        // exactly "the first byte after the compiled initcode". That makes it the start of the
        // caller-appended payload.
        let payloadCursor := dataoffset("user_payload_anchor")
        let payloadEnd := codesize()

        // Memory layout used by this program:
        // - 0x00..0x1f: scratch space for reading the current entry header
        // - 0x20..... : output buffer that will become the eth_call return value
        //
        // writePtr always points to "where the next result entry should be written".
        let responsePtr := 0x20
        let writePtr := responsePtr

        // Infinite loop with an explicit break once all payload bytes are consumed.
        for {} 1 {} {
            if eq(payloadCursor, payloadEnd) {
                break
            }

            // Read up to 32 bytes starting at the current payload cursor into scratch memory.
            //
            // Why 32 bytes?
            // - the fixed-size call header is only 22 bytes
            // - loading one full word lets us extract both the address and the calldata length with
            //   simple shifts/byte reads
            //
            // CODECOPY pads with zeros if it reads past the end of code. That is why we still need
            // an explicit bounds check later: without it, a truncated entry would silently decode as
            // zeros instead of failing.
            codecopy(0x00, payloadCursor, 0x20)

            let headerWord := mload(0x00)

            // The first 20 bytes are the address. mload gives us a 32-byte word, so we shift right
            // by 12 bytes (96 bits) to drop the padding and keep the address in the low 20 bytes.
            let target := shr(96, headerWord)

            // Bytes 20 and 21 store the calldata length as a big-endian uint16.
            let calldataSize := or(shl(8, byte(20, headerWord)), byte(21, headerWord))

            let calldataOffset := add(payloadCursor, callHeaderSize)
            let nextCursor := add(calldataOffset, calldataSize)

            // Reject truncated entries. This single check covers both:
            // - not enough bytes for the 22-byte header
            // - not enough bytes for the calldata that the header claims exists
            if gt(nextCursor, payloadEnd) {
                revert(0x00, 0x00)
            }

            // The next result entry will be written at writePtr. Its first 2 bytes are the packed
            // header, so the calldata scratch area can safely start immediately after that header.
            let calldataPtr := add(writePtr, 0x02)

            // Copy just this call's calldata into memory so CALL can read it.
            codecopy(calldataPtr, calldataOffset, calldataSize)

            // Execute the external call with:
            // - all remaining gas
            // - zero ETH value
            // - calldata in memory at calldataPtr
            // - no output buffer yet, because we do not know returndata size in advance
            let success := call(gas(), target, 0, calldataPtr, calldataSize, 0, 0)
            let returndataSize := returndatasize()

            // The low 15 bits of the packed result header store returndata length, so one entry
            // cannot exceed 0x7fff bytes.
            if gt(returndataSize, maxEntrySize) {
                revert(0x00, 0x00)
            }

            // Compute where the next result entry would begin after writing:
            //   2-byte packed header + returndata bytes
            let nextWritePtr := add(add(writePtr, 0x02), returndataSize)

            // Intentionally do not enforce an aggregate response-size cap here. CREATE-style
            // execution already treats returned bytes as would-be runtime code, so the active
            // chain/client/RPC environment will reject oversized responses according to its own
            // code-size policy. Keeping this uncapped lets the same Ghostcall initcode benefit from
            // networks with larger limits, such as Monad's MIP-2:
            // https://mips.monad.xyz/MIPS/MIP-2

            // Write the packed 2-byte result header into the high 2 bytes of the 32-byte word at
            // writePtr. The rest of that word does not matter because the return length is computed
            // explicitly at the end.
            mstore(writePtr, shl(240, or(shl(15, success), returndataSize)))

            // Append the raw returndata bytes immediately after the 2-byte header.
            returndatacopy(add(writePtr, 0x02), 0, returndataSize)

            // Advance both cursors:
            // - writePtr moves to the start of the next result entry
            // - payloadCursor moves to the next input entry
            writePtr := nextWritePtr
            payloadCursor := nextCursor
        }

        // Return exactly the bytes that were written to the response buffer.
        return(responsePtr, sub(writePtr, responsePtr))

    }

    data "user_payload_anchor" hex""
}
